import os
import requests
from dotenv import load_dotenv
from datetime import datetime
from collections import defaultdict

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
while has_more and page_count < 40:
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

daily_counts = defaultdict(int)
daily_spend = defaultdict(float)
daily_answered = defaultdict(int)

for c in all_cdrs:
    start_time_str = c.get("start_time")
    if start_time_str:
        dt = datetime.strptime(start_time_str, "%Y-%m-%dT%H:%M:%SZ")
        day_str = dt.strftime("%Y-%m-%d")
        daily_counts[day_str] += 1
        daily_spend[day_str] += float(c.get("total_cost") or 0)
        if float(c.get("duration") or 0) > 0 or c.get("hangup_cause_name") in ["NORMAL_CLEARING", "Completed"]:
            daily_answered[day_str] += 1

print("\n--- DAILY BREAKDOWN ---")
for day in sorted(daily_counts.keys()):
    count = daily_counts[day]
    spend = daily_spend[day]
    ans = daily_answered[day]
    pickup = (ans / count * 100) if count > 0 else 0
    print(f"Date: {day} | Calls: {count} | Spend: INR {spend:.2f} | Pickup Rate: {pickup:.1f}%")
