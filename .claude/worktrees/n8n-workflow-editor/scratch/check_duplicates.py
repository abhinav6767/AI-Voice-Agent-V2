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
uuids = [c.get("uuid") for c in all_cdrs]
unique_uuids = set(uuids)
print(f"Unique UUIDs: {len(unique_uuids)}")
print(f"Duplicate UUID count: {len(uuids) - len(unique_uuids)}")
