import os
import requests
from dotenv import load_dotenv
from collections import Counter

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

print(f"Total CDRs: {len(all_cdrs)}")
trunk_ids = Counter(c.get("trunk_id") for c in all_cdrs)
print("Trunk IDs:", dict(trunk_ids))

call_directions = Counter(c.get("call_direction") for c in all_cdrs)
print("Directions:", dict(call_directions))

caller_numbers = Counter(c.get("caller_id_number") for c in all_cdrs)
print("Unique caller numbers count:", len(caller_numbers))
print("Top 10 callers:", caller_numbers.most_common(10))

dest_numbers = Counter(c.get("destination_number") for c in all_cdrs)
print("Unique destination numbers count:", len(dest_numbers))
print("Top 10 destinations:", dest_numbers.most_common(10))

# Check billing status
billing_status = Counter(c.get("billing_status") for c in all_cdrs)
print("Billing status:", dict(billing_status))

# Check context
contexts = Counter(c.get("context") for c in all_cdrs)
print("Contexts:", dict(contexts))
