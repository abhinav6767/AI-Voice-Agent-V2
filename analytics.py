import os
import json
import logging
import datetime
from groq import Groq

logger = logging.getLogger("analytics")

DATA_DIR = "data"
LEADS_FILE = os.path.join(DATA_DIR, "leads.csv")
LOGS_FILE = os.path.join(DATA_DIR, "call_logs.json")

def save_lead_csv(name: str, phone: str, city: str, email: str = "", status: str = "contact_captured", intent: str = ""):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        write_header = not os.path.exists(LEADS_FILE)
        with open(LEADS_FILE, "a", encoding="utf-8") as f:
            if write_header:
                f.write("Timestamp,Name,Phone,City,Email,Status,Intent\n")
            timestamp = datetime.datetime.now().isoformat()
            f.write(f'"{timestamp}","{name}","{phone}","{city}","{email}","{status}","{intent}"\n')
        logger.info(f"[ANALYTICS] Lead saved to CSV — status={status!r}, intent={intent!r}.")
    except Exception as e:
        logger.error(f"[ANALYTICS] Failed to save lead: {e}")

async def analyze_and_save_call(phone_number: str, direction: str, chat_messages: list):
    try:
        os.makedirs(DATA_DIR, exist_ok=True)
        
        # Build transcript — skip system messages (avoids hitting token limits with large prompts)
        transcript = []
        for msg in chat_messages:
            role = getattr(msg, "role", "unknown")
            if role == "system":
                continue  # exclude system prompt from transcript
            content = getattr(msg, "content", "")
            if isinstance(content, list):
                content = " ".join([str(c) for c in content])
            if content and str(content).strip():
                transcript.append(f"{role}: {content}")
            
        full_transcript = "\n".join(transcript)
        
        # Skip analysis if no real conversation happened
        if not full_transcript.strip():
            analysis = {"summary": "No conversation recorded.", "sentiment": "Neutral", "caller_intent": "Unknown"}
        else:
            # Use llama-3.1-8b-instant: higher rate limits (20K TPM) vs 70b model (12K TPM)
            client = Groq(api_key=os.getenv("GROQ_API_KEY"))
            prompt = (
                "Analyze the following call transcript. Provide a JSON response with exactly these keys:\n"
                "- \"summary\": A 1-2 sentence summary of the call.\n"
                "- \"sentiment\": Positive, Neutral, or Negative.\n"
                "- \"caller_intent\": What the caller was asking about or wanted.\n"
                "- \"user_info\": A JSON object containing extracted details about the user (e.g., 'name', 'phone', 'purpose', 'appointment_details', 'city', 'email', etc.). Include all relevant info discussed in the call. If not mentioned, leave null.\n\n"
                f"Transcript:\n{full_transcript}"
            )
            
            response = client.chat.completions.create(
                messages=[{"role": "user", "content": prompt}],
                model="llama-3.1-8b-instant",
                response_format={"type": "json_object"}
            )
            analysis = json.loads(response.choices[0].message.content)
        
        # Append to call_logs.json
        logs = []
        if os.path.exists(LOGS_FILE):
            try:
                with open(LOGS_FILE, "r", encoding="utf-8") as f:
                    logs = json.load(f)
            except Exception:
                pass
                
        log_entry = {
            "timestamp": datetime.datetime.now().isoformat(),
            "phone_number": phone_number,
            "direction": direction,
            "summary": analysis.get("summary", "No summary available"),
            "sentiment": analysis.get("sentiment", "Neutral"),
            "caller_intent": analysis.get("caller_intent", "Unknown"),
            "user_info": analysis.get("user_info", {}),
            "transcript": full_transcript
        }
        
        logs.append(log_entry)
        
        with open(LOGS_FILE, "w", encoding="utf-8") as f:
            json.dump(logs, f, indent=2)
            
        logger.info("[ANALYTICS] Call log and sentiment saved.")
        
        # Automatically save all inbound calls as leads if they have info
        if direction == "inbound":
            user_info = analysis.get("user_info", {})
            name = user_info.get("name", "Unknown")
            city = user_info.get("city", "")
            email = user_info.get("email", "")
            intent = analysis.get("caller_intent", "")
            save_lead_csv(name, phone_number, city, email, "contact_captured", intent)
        
    except Exception as e:
        logger.error(f"[ANALYTICS] Failed to analyze/save call log: {e}")
