import os
import certifi
os.environ['SSL_CERT_FILE'] = certifi.where()

import logging
import json
import asyncio
from dotenv import load_dotenv

from livekit import agents, api
from livekit.agents import AgentSession, Agent, RoomInputOptions
from livekit.plugins import openai, cartesia, deepgram, noise_cancellation, silero, sarvam
try:
    from livekit.plugins import google as google_plugin
    _HAS_GOOGLE = True
except ImportError:
    _HAS_GOOGLE = False
from livekit.agents import llm
from typing import Optional

load_dotenv(".env")

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logging.getLogger("aiohttp").setLevel(logging.WARNING)
logging.getLogger("livekit").setLevel(logging.INFO)
logger = logging.getLogger("inbound-agent")

# Import the INBOUND config directly — no routing needed
import config_inbound as config

logger.info(f"[INBOUND] Agent loaded -> {getattr(config, 'AGENT_NAME', 'Unknown')}")

# Pre-load VAD model at startup (avoids cold-load delay on first call)
_VAD = silero.VAD.load()


# =============================================================================
# HELPERS
# =============================================================================

def _build_tts(provider_override: str = None, voice_override: str = None):
    provider = (provider_override or os.getenv("TTS_PROVIDER", config.DEFAULT_TTS_PROVIDER)).lower()

    # Route to Sarvam if the voice override is a known Sarvam speaker (bulbul:v3 compatible list)
    _SARVAM_VOICES = {
        "shubh", "ritu", "rahul", "pooja", "simran", "kavya", "amit",
        "ratan", "rohan", "dev", "ishita", "shreya", "manan", "sumit",
        "priya", "aditya", "kabir", "neha", "varun", "roopa", "aayan",
        "ashutosh", "advait", "amelia", "sophia",
    }
    if voice_override in _SARVAM_VOICES:
        provider = "sarvam"

    if provider == "cartesia":
        return cartesia.TTS(
            model=os.getenv("CARTESIA_TTS_MODEL", config.CARTESIA_MODEL),
            voice=os.getenv("CARTESIA_TTS_VOICE", config.CARTESIA_VOICE),
        )
    if provider == "sarvam":
        model    = os.getenv("SARVAM_TTS_MODEL", config.SARVAM_MODEL)
        voice    = voice_override or os.getenv("SARVAM_VOICE", config.DEFAULT_TTS_VOICE)
        language = os.getenv("SARVAM_LANGUAGE", config.SARVAM_LANGUAGE)
        logger.info(f"[TTS] Sarvam — model={model}, speaker={voice}, lang={language}")
        return sarvam.TTS(model=model, speaker=voice, target_language_code=language)
    if provider == "deepgram":
        return deepgram.TTS(model=os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en"))
    if os.getenv("OPENAI_API_KEY"):
        return openai.TTS(
            model=os.getenv("OPENAI_TTS_MODEL", "tts-1"),
            voice=voice_override or os.getenv("OPENAI_TTS_VOICE", config.DEFAULT_TTS_VOICE),
        )
    return deepgram.TTS(model=os.getenv("DEEPGRAM_TTS_MODEL", "aura-asteria-en"))


def _build_llm(provider_override: str = None):
    provider = (provider_override or os.getenv("LLM_PROVIDER", config.DEFAULT_LLM_PROVIDER)).lower()

    if provider == "groq":
        logger.info("[LLM] Groq")
        return openai.LLM(
            base_url="https://api.groq.com/openai/v1",
            api_key=os.getenv("GROQ_API_KEY"),
            model=os.getenv("GROQ_MODEL", config.GROQ_MODEL),
            temperature=float(os.getenv("GROQ_TEMPERATURE", str(config.GROQ_TEMPERATURE))),
        )

    if provider in ("google", "gemini"):
        gemini_key = os.getenv("GEMINI_API_KEY")
        if gemini_key and _HAS_GOOGLE:
            logger.info("[LLM] Google Gemini")
            return google_plugin.LLM(
                model=os.getenv("GEMINI_MODEL", "gemini-2.0-flash"),
                api_key=gemini_key,
            )
        logger.warning("[LLM] Google requested but plugin/key not available — falling back to Groq")

    if provider == "openai":
        openai_key = os.getenv("OPENAI_API_KEY")
        if openai_key:
            logger.info("[LLM] OpenAI")
            return openai.LLM(
                api_key=openai_key,
                model=os.getenv("OPENAI_MODEL", config.DEFAULT_LLM_MODEL),
            )
        logger.warning("[LLM] OpenAI requested but OPENAI_API_KEY not set — falling back to Groq")

    # Safe default: Groq (always configured)
    logger.info("[LLM] Groq (default fallback)")
    return openai.LLM(
        base_url="https://api.groq.com/openai/v1",
        api_key=os.getenv("GROQ_API_KEY"),
        model=os.getenv("GROQ_MODEL", config.GROQ_MODEL),
        temperature=float(os.getenv("GROQ_TEMPERATURE", str(config.GROQ_TEMPERATURE))),
    )


# =============================================================================
# TOOLS
# =============================================================================

class InboundTools(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext):
        super().__init__(tools=[])
        self.ctx       = ctx
        self.lead_info = {}

    @llm.function_tool(
        description=(
            "Save the caller's contact information after you have collected their "
            "name, phone number, and city. Call this once ALL THREE are confirmed. "
            "This is just contact capture — it does NOT mean the lead is qualified."
        )
    )
    def save_lead_info(self, name: str, phone: str, city: str, email: str = ""):
        """
        Store caller lead details and confirm collection.

        Args:
            name:  Caller's full name
            phone: Caller's phone number
            city:  Caller's city or location
            email: Caller's email address (optional — capture if they offer it)
        """
        self.lead_info = {"name": name, "phone": phone, "city": city, "email": email}
        logger.info(f"[LEAD] 📋 Contact captured → name={name!r}, phone={phone!r}, city={city!r}, email={email!r}")

        # Write to CSV (contact info only, not yet qualified)
        import analytics
        analytics.save_lead_csv(name, phone, city, email=email, status="contact_captured")

        return (
            f"Thank you, {name}! I've noted your details from {city}. "
            f"Now, let me check the available time slots for our doctors — "
            f"what would you like to know first?"
        )

    @llm.function_tool(
        description=(
            "Mark this lead as QUALIFIED and successful. Call this ONLY when the caller "
            "expresses a clear, specific buying intent — such as: requesting a test drive, "
            "asking for a home/doorstep demo, wanting to visit the showroom, asking to book "
            "an appointment, requesting a personalised quote with intent to purchase, or "
            "saying they want to buy. DO NOT call this just because they gave their contact info "
            "or asked general questions about the car."
        )
    )
    def mark_lead_qualified(self, intent: str):
        """
        Mark the lead as qualified based on expressed buying intent.

        Args:
            intent: What specific action the caller requested (e.g. 'test drive booking',
                    'home demo request', 'showroom visit', 'price quote for purchase')
        """
        name  = self.lead_info.get("name", "Caller")
        phone = self.lead_info.get("phone", "")
        city  = self.lead_info.get("city", "")
        email = self.lead_info.get("email", "")

        logger.info(f"[LEAD] ✅ QUALIFIED → intent={intent!r}, name={name!r}, phone={phone!r}")

        import analytics
        analytics.save_lead_csv(name, phone, city, email=email, status="qualified", intent=intent)

        return (
            f"Excellent! I've noted your request for a {intent}. "
            f"Our team will be in touch with you shortly to confirm all the details. "
            f"Is there anything else I can help you with in the meantime?"
        )

    @llm.function_tool(description="Transfer the caller to a live human sales representative.")
    async def transfer_to_sales(self, destination: Optional[str] = None):
        """Transfer inbound caller to a live sales rep. Args: destination: optional override number."""
        target = destination or config.DEFAULT_TRANSFER_NUMBER
        if not target:
            return "Our sales team is unavailable right now. I'll arrange a callback for you shortly."

        if "@" not in target:
            if config.SIP_DOMAIN:
                clean = target.replace("tel:", "").replace("sip:", "")
                target = f"sip:{clean}@{config.SIP_DOMAIN}"
            elif not target.startswith("tel:"):
                target = f"tel:{target}"
        elif not target.startswith("sip:"):
            target = f"sip:{target}"

        participant_identity = None
        for p in self.ctx.room.remote_participants.values():
            participant_identity = p.identity
            break

        if not participant_identity:
            return "Failed to transfer: could not identify the caller."

        try:
            await self.ctx.api.sip.transfer_sip_participant(
                api.TransferSIPParticipantRequest(
                    room_name=self.ctx.room.name,
                    participant_identity=participant_identity,
                    transfer_to=target,
                    play_dialtone=False,
                )
            )
            logger.info(f"[TOOL] Transferred inbound caller to {target}")
            return "Connecting you to a sales representative now — please hold!"
        except Exception as e:
            logger.error(f"[TOOL] Transfer failed: {e}")
            return f"I'm sorry, I couldn't complete the transfer. {e}"


# =============================================================================
# AGENT
# =============================================================================

class InboundAssistant(Agent):
    """Doctor's Receptionist — leads with info capture, then assists with appointments."""
    def __init__(self, tools: list):
        super().__init__(instructions=config.SYSTEM_PROMPT, tools=tools)
        logger.info("[INBOUND] InboundAssistant initialised.")


# =============================================================================
# ENTRYPOINT
# =============================================================================

async def entrypoint(ctx: agents.JobContext):
    # Reload config from dashboard JSON on every new call
    config.load_dashboard_config()

    logger.info("=" * 60)
    logger.info("[INBOUND] *** NEW INBOUND CALL ***")
    logger.info(f"[INBOUND] Room: {ctx.room.name} | Job: {ctx.job.id}")
    logger.info("=" * 60)

    await ctx.connect()
    logger.info(f"[INBOUND] Connected. Remote participants: {len(ctx.room.remote_participants)}")

    # Log metadata (informational only — inbound doesn't need phone from metadata)
    try:
        if ctx.job.metadata:
            logger.info(f"[INBOUND] Job metadata: {ctx.job.metadata!r}")
    except Exception:
        pass

    # --- Build plugins ---
    fnc_ctx   = InboundTools(ctx)
    built_tts = _build_tts()
    built_llm = _build_llm()

    # Support dynamic language detection or code-switching if set to 'auto'
    is_auto = (config.STT_LANGUAGE == "auto")
    session = AgentSession(
        vad=_VAD,  # reuse pre-loaded model — no disk I/O on call start
        stt=deepgram.STT(
            model=config.STT_MODEL,
            language=config.STT_LANGUAGE if not is_auto else "en-US",
            detect_language=is_auto,
        ),
        llm=built_llm,
        tts=built_tts,
    )

    agent_instance = InboundAssistant(
        tools=list(fnc_ctx.function_tools.values()),
    )

    @ctx.room.on("disconnected")
    def on_disconnected(*args, **kwargs):
        logger.info("[INBOUND] Call disconnected. Running analytics...")
        import analytics
        msgs = agent_instance.chat_ctx.messages() if callable(getattr(agent_instance.chat_ctx, "messages", None)) else getattr(agent_instance.chat_ctx, "messages", [])
        asyncio.create_task(
            analytics.analyze_and_save_call(
                phone_number="inbound_caller",
                direction="inbound",
                chat_messages=msgs
            )
        )

    await session.start(
        room=ctx.room,
        agent=agent_instance,
        room_input_options=RoomInputOptions(
            noise_cancellation=noise_cancellation.BVCTelephony(),
            close_on_disconnect=True,
        ),
    )
    logger.info("[INBOUND] Session started.")

    # Greet the caller immediately using say() which goes straight to TTS.
    # No LLM round-trip needed for the greeting — saves 1-2 seconds.
    try:
        await session.say(config.INITIAL_GREETING, allow_interruptions=True)
        logger.info("[INBOUND] Welcome greeting dispatched.")
    except Exception as e:
        logger.error(f"[INBOUND] Greeting failed: {e}")
        import traceback; logger.error(traceback.format_exc())


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="inbound-caller",   # Must match LiveKit inbound dispatch rule
        )
    )
