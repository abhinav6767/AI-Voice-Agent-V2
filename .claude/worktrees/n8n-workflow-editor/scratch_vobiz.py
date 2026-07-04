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

url = f"https://api.vobiz.ai/api/v1/Account/{auth_id}/Recording/?limit=1"
res = requests.get(url, headers=headers)
if res.ok:
    data = res.json()
    items = data.get("objects", [])
    if items:
        print("Keys:", list(items[0].keys()))
        print("Sample:", json.dumps(items[0], indent=2))
else:
    print("Error:", res.status_code, res.text)
