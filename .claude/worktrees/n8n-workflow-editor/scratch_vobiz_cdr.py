import os
import requests
import json
from dotenv import load_dotenv

load_dotenv()

auth_id = os.getenv("VOBIZ_AUTH_ID")
auth_token = os.getenv("VOBIZ_AUTH_TOKEN")

headers = {
    "X-Auth-ID": auth_id,
    "X-Auth-Token": auth_token,
    "Accept": "application/json"
}

all_cdrs = []
offset = 0
has_more = True
page_count = 0

print("Fetching CDRs...")
while has_more and page_count < 20:
    url = f"https://api.vobiz.ai/api/v1/Account/{auth_id}/cdr/recent?limit=100&offset={offset}"
    res = requests.get(url, headers=headers)
    if res.ok:
        json_data = res.json()
        if json_data.get("success") and json_data.get("data"):
            data = json_data["data"]
            all_cdrs.extend(data)
            offset += len(data)
            page_count += 1
            if len(data) < 100:
                has_more = False
        else:
            has_more = False
    else:
        print("Error:", res.status_code, res.text)
        has_more = False

print(f"Total CDRs fetched: {len(all_cdrs)}")

# Check keys of a CDR
if all_cdrs:
    print("CDR Keys:", list(all_cdrs[0].keys()))
    print("Sample CDR:", json.dumps(all_cdrs[0], indent=2))

# Compute stats
total_calls = len(all_cdrs)
total_spend = sum(float(c.get("total_cost") or 0) for c in all_cdrs)
sip_trunk_calls = sum(1 for c in all_cdrs if c.get("sip_call_id"))
voice_api_calls = total_calls - sip_trunk_calls

# Answered/Pickup Rate
# Let's see what values hangup_cause_name, duration, billsec etc. have
answered_calls = sum(1 for c in all_cdrs if float(c.get("duration") or 0) > 0 or c.get("hangup_cause_name") in ["NORMAL_CLEARING", "Completed"])
pickup_rate = (answered_calls / total_calls * 100) if total_calls > 0 else 0

active_numbers = len(set(c.get("destination_number") or c.get("caller_id_number") for c in all_cdrs if c.get("call_direction") == "inbound" and (c.get("destination_number") or c.get("caller_id_number"))))
if active_numbers == 0:
    active_numbers = 1

print("\n--- STATS ---")
print(f"Calls Made: {total_calls}")
print(f"Total Spend: INR {total_spend}")
print(f"Call Pickup Rate: {pickup_rate}% (Answered: {answered_calls})")
print(f"SIP Trunk Calls: {sip_trunk_calls}")
print(f"Voice API Calls: {voice_api_calls}")
print(f"Active Numbers: {active_numbers}")
