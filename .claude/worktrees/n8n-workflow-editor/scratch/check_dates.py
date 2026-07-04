import os
import requests
from dotenv import load_dotenv
from datetime import datetime

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
while has_more and page_count < 30:
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
        has_more = False

print(f"Total CDRs fetched: {len(all_cdrs)}")

# Count CDRs in June 2026 (2026-06-01 to 2026-06-30 inclusive)
june_cdrs = []
other_cdrs = []
for c in all_cdrs:
    start_time_str = c.get("start_time")
    if start_time_str:
        # e.g., "2026-06-29T14:26:19Z"
        dt = datetime.strptime(start_time_str, "%Y-%m-%dT%H:%M:%SZ")
        if dt.year == 2026 and dt.month == 6:
            june_cdrs.append(c)
        else:
            other_cdrs.append(c)

print(f"June 2026 CDRs count: {len(june_cdrs)}")
print(f"Other CDRs count: {len(other_cdrs)}")
if other_cdrs:
    print(f"Sample other CDR date: {other_cdrs[0].get('start_time')}")
if june_cdrs:
    total_spend = sum(float(c.get("total_cost") or 0) for c in june_cdrs)
    answered_calls = sum(1 for c in june_cdrs if float(c.get("duration") or 0) > 0 or c.get("hangup_cause_name") in ["NORMAL_CLEARING", "Completed"])
    pickup_rate = (answered_calls / len(june_cdrs) * 100) if june_cdrs else 0
    active_numbers = len(set(c.get("destination_number") or c.get("caller_id_number") for c in june_cdrs if c.get("call_direction") == "inbound" and (c.get("destination_number") or c.get("caller_id_number"))))
    
    print("\n--- JUNE 2026 STATS ---")
    print(f"Calls Made: {len(june_cdrs)}")
    print(f"Total Spend: INR {total_spend}")
    print(f"Call Pickup Rate: {pickup_rate}% (Answered: {answered_calls})")
    print(f"Active Numbers: {active_numbers}")
