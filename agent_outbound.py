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


def _normalize_phone(number: str) -> str:
    """Ensure phone is in E.164 format. Defaults to +91 for 10-digit Indian numbers."""
    if not number:
        return number
    # Strip whitespace and any existing formatting
    number = number.strip().replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    if number.startswith("+"):
        return number  # Already E.164
    if number.startswith("91") and len(number) == 12:
        return f"+{number}"  # 91XXXXXXXXXX -> +91XXXXXXXXXX
    if len(number) == 10:
        return f"+91{number}"  # 10-digit Indian mobile
    # Fallback: just prepend +
    return f"+{number}"

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S"
)
logging.getLogger("aiohttp").setLevel(logging.WARNING)
logging.getLogger("livekit").setLevel(logging.INFO)
logger = logging.getLogger("outbound-agent")

# Import the OUTBOUND config directly — no routing needed
import config_outbound as config

logger.info(f"[OUTBOUND] Agent loaded -> {getattr(config, 'AGENT_NAME', 'Unknown')}")

# Pre-load VAD model at startup so it's ready instantly when a call arrives
# (avoids ~1-2s cold-load delay on first call)
_VAD = silero.VAD.load()


# =============================================================================
# HELPERS
# =============================================================================

def _build_tts(provider_override: str = None, voice_override: str = None, language_override: str = None):
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
        language = language_override or os.getenv("SARVAM_LANGUAGE", config.SARVAM_LANGUAGE)
        logger.info(f"[TTS] Sarvam -- model={model}, speaker={voice}, lang={language}")
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

class OutboundTools(llm.ToolContext):
    def __init__(self, ctx: agents.JobContext, phone_number: str = None):
        super().__init__(tools=[])
        self.ctx = ctx
        self.phone_number = phone_number

    @llm.function_tool(description="Look up user details by phone number.")
    async def lookup_user(self, phone: str):
        """Args: phone: phone number to look up."""
        logger.info(f"[TOOL] lookup_user: {phone}")
        return "User found: Shreyas Raj. Status: Premium. Last order: Coffee setup (Delivered)."

    @llm.function_tool(description="Transfer the call to a human support agent or another number.")
    async def transfer_call(self, destination: Optional[str] = None):
        """Transfer the call. Args: destination: SIP URI or phone number."""
        target = destination or config.DEFAULT_TRANSFER_NUMBER
        if not target:
            return "Error: No default transfer number configured."

        if "@" not in target:
            if config.SIP_DOMAIN:
                clean = target.replace("tel:", "").replace("sip:", "")
                target = f"sip:{clean}@{config.SIP_DOMAIN}"
            elif not target.startswith("tel:"):
                target = f"tel:{target}"
        elif not target.startswith("sip:"):
            target = f"sip:{target}"

        participant_identity = None
        if self.phone_number:
            participant_identity = f"sip_{self.phone_number}"
        else:
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
            logger.info(f"[TOOL] Transfer initiated to {target}")
            return "Transfer initiated successfully."
        except Exception as e:
            logger.error(f"[TOOL] Transfer failed: {e}")
            return f"Error executing transfer: {e}"


# =============================================================================
# AGENT
# =============================================================================

class OutboundAssistant(Agent):
    def __init__(self, tools: list, user_prompt: str = None, tts_language: str = None):
        if user_prompt and user_prompt.strip():
            instructions = (
                f"{config.SYSTEM_PROMPT}\n\n"
                f"## Additional Context for This Call:\n{user_prompt.strip()}"
            )
        else:
            instructions = config.SYSTEM_PROMPT
            
        if tts_language and "en" not in tts_language.lower():
            instructions += f"\n\nCRITICAL: You MUST speak entirely in the language code '{tts_language}'. Do NOT speak English."
            
        super().__init__(instructions=instructions, tools=tools)


# =============================================================================
# ENTRYPOINT
# =============================================================================

async def entrypoint(ctx: agents.JobContext):
    # Reload config from dashboard JSON on every new call
    config.load_dashboard_config()

    logger.info("=" * 60)
    logger.info("[OUTBOUND] *** NEW OUTBOUND JOB ***")
    logger.info(f"[OUTBOUND] Room: {ctx.room.name} | Job: {ctx.job.id}")
    logger.info("=" * 60)

    await ctx.connect()
    logger.info(f"[OUTBOUND] Connected. Remote participants: {len(ctx.room.remote_participants)}")

    # --- Parse metadata ---
    phone_number = None
    config_dict  = {}

    try:
        if ctx.job.metadata:
            data        = json.loads(ctx.job.metadata)
            phone_number = data.get("phone_number")
            config_dict = data
            logger.info(f"[OUTBOUND] Job metadata -> phone={phone_number!r}")
    except Exception as e:
        logger.error(f"[OUTBOUND] Job metadata parse error: {e}")

    try:
        if ctx.room.metadata:
            data = json.loads(ctx.room.metadata)
            if data.get("phone_number"):
                phone_number = data["phone_number"]
            config_dict.update(data)
            logger.info(f"[OUTBOUND] Room metadata -> phone={phone_number!r}")
    except Exception as e:
        logger.error(f"[OUTBOUND] Room metadata parse error: {e}")

    # --- Build plugins ---
    fnc_ctx   = OutboundTools(ctx, phone_number)
    built_tts = _build_tts(
        config_dict.get("tts_provider"),
        config_dict.get("voice_id"),
        config_dict.get("tts_language")
    )
    built_llm = _build_llm(config_dict.get("model_provider"))

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

    user_prompt = config_dict.get("user_prompt", "")
    agent_instance = OutboundAssistant(
        tools=list(fnc_ctx.function_tools.values()),
        user_prompt=user_prompt,
        tts_language=config_dict.get("tts_language")
    )

    @ctx.room.on("disconnected")
    def on_disconnected(*args, **kwargs):
        logger.info("[OUTBOUND] Call disconnected. Running analytics...")
        import analytics
        msgs = agent_instance.chat_ctx.messages() if callable(getattr(agent_instance.chat_ctx, "messages", None)) else getattr(agent_instance.chat_ctx, "messages", [])
        asyncio.create_task(
            analytics.analyze_and_save_call(
                phone_number=phone_number or "unknown",
                direction="outbound",
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
    logger.info("[OUTBOUND] Session started.")

    # Warm up the TTS connection by speaking a silent space.
    # This initializes the connection and websocket early, eliminating cold-start latency when greeting.
    async def warm_up():
        await session.say(" ", allow_interruptions=True)
    asyncio.create_task(warm_up())

    # --- Dial or greet ---
    remote_participants = list(ctx.room.remote_participants.values())
    logger.info(f"[OUTBOUND] Remote participants: {len(remote_participants)}")

    should_dial        = False
    user_already_here  = False

    if phone_number:
        for p in remote_participants:
            # Match with or without + prefix in identity
            clean = phone_number.lstrip('+')
            if f"sip_{phone_number}" in p.identity or f"sip_{clean}" in p.identity or "sip_" in p.identity:
                user_already_here = True
                logger.info(f"[OUTBOUND] SIP participant already in room: {p.identity!r}")
                break
        should_dial = not user_already_here
    else:
        logger.warning("[OUTBOUND] No phone_number. Skipping dial-out.")

    if should_dial:
        e164_number = _normalize_phone(phone_number)
        # Strip '+' from identity — WebRTC layer can't parse '+' as integer
        safe_identity = f"sip_{e164_number.lstrip('+')}"
        logger.info(f"[OUTBOUND] Dialling {e164_number} (raw={phone_number}) via trunk {config.SIP_TRUNK_ID}...")
        try:
            await ctx.api.sip.create_sip_participant(
                api.CreateSIPParticipantRequest(
                    room_name=ctx.room.name,
                    sip_trunk_id=config.SIP_TRUNK_ID,
                    sip_call_to=e164_number,
                    participant_identity=safe_identity,
                    wait_until_answered=True,
                )
            )
            logger.info("[OUTBOUND] Call answered. Speaking greeting instantly...")
            # Use say() to stream pre-written greeting directly to TTS.
            # This is MUCH faster than generate_reply() which needs a full LLM round-trip.
            await session.say(config.INITIAL_GREETING, allow_interruptions=True)
        except Exception as e:
            logger.error(f"[OUTBOUND] Dial failed: {e}")
            import traceback; logger.error(traceback.format_exc())
            ctx.shutdown()
    else:
        logger.info("[OUTBOUND] Speaking fallback greeting instantly...")
        try:
            # No sleep needed — say() streams directly to TTS, no LLM latency
            await session.say(config.INITIAL_GREETING, allow_interruptions=True)
        except Exception as e:
            logger.error(f"[OUTBOUND] Fallback greeting failed: {e}")
            import traceback; logger.error(traceback.format_exc())


if __name__ == "__main__":
    agents.cli.run_app(
        agents.WorkerOptions(
            entrypoint_fnc=entrypoint,
            agent_name="outbound-caller",   # Must match LiveKit outbound dispatch rule
        )
    )
