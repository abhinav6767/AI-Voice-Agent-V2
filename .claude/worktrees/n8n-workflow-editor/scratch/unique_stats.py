import os
import requests
from dotenv import load_dotenv

load_dotenv()

auth_id = os.getenv("VOBIZ_AUTH_ID")
auth_token = os.getenv("VOBIZ_AUTH_TOKEN")

headers = {
    "X-Auth-ID": auth_id,
    "X-Auth-Token": auth_token,
    "Accept": "application/json"
}

url = f"https://api.vobiz.ai/api/v1/Account/{auth_id}/cdr/recent?limit=100"
res = requests.get(url, headers=headers)
if res.ok:
    json_data = res.json()
    data = json_data.get("data", [])
    
    # De-duplicate by uuid
    unique_cdrs = {}
    for c in data:
        uid = c.get("uuid")
        if uid not in unique_cdrs:
            unique_cdrs[uid] = c
            
    cdrs = list(unique_cdrs.values())
    
    total_calls = len(cdrs)
    total_spend = sum(float(c.get("total_cost") or 0) for c in cdrs)
    sip_trunk_calls = sum(1 for c in cdrs if c.get("sip_call_id"))
    voice_api_calls = total_calls - sip_trunk_calls
    
    answered_calls = sum(1 for c in cdrs if float(c.get("duration") or 0) > 0 or c.get("hangup_cause_name") in ["NORMAL_CLEARING", "Completed"])
    pickup_rate = (answered_calls / total_calls * 100) if total_calls > 0 else 0
    
    active_numbers = len(set(c.get("destination_number") or c.get("caller_id_number") for c in cdrs if c.get("call_direction") == "inbound" and (c.get("destination_number") or c.get("caller_id_number"))))
    if active_numbers == 0:
         active_numbers = 1
         
    print("--- UNIQUE CDR STATS (1 page) ---")
    print(f"Calls: {total_calls}")
    print(f"Spend: INR {total_spend}")
    print(f"Pickup Rate: {pickup_rate:.1f}%")
    print(f"SIP Trunk: {sip_trunk_calls}")
    print(f"Voice API: {voice_api_calls}")
    print(f"Active Numbers: {active_numbers}")
else:
    print("Error:", res.status_code)
