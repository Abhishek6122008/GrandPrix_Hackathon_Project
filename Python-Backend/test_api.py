#!/usr/bin/env python3
import json
import urllib.request
import urllib.error
import sys

BASE_URL = "http://127.0.0.1:8000"

def send_request(method, path, data=None):
    url = f"{BASE_URL}{path}"
    req = urllib.request.Request(url, method=method)
    req.add_header("Content-Type", "application/json")
    
    if data is not None:
        jsondata = json.dumps(data).encode("utf-8")
        req.data = jsondata
        
    print(f"\n---> Sending {method} {path}...")
    try:
        with urllib.request.urlopen(req) as response:
            res_body = response.read().decode("utf-8")
            print(f"Status Code: {response.status}")
            try:
                parsed = json.loads(res_body)
                print(json.dumps(parsed, indent=2))
                return parsed
            except json.JSONDecodeError:
                print(res_body)
                return res_body
    except urllib.error.HTTPError as e:
        print(f"HTTP Error: {e.code}")
        print(e.read().decode("utf-8"))
    except urllib.error.URLError as e:
        print(f"Connection Error: {e.reason}")
        print("Make sure your FastAPI server is running with 'uvicorn app:app --reload'")
        sys.exit(1)

def main():
    # Load test data
    try:
        with open("test_data.json", "r") as f:
            test_data = json.load(f)
    except FileNotFoundError:
        print("Error: test_data.json not found in the current directory.")
        sys.exit(1)

    print("=== STARTING API TEST ===")
    
    # 1. Initialize simulation
    init_res = send_request("POST", "/simulation/init", test_data["init_payload"])
    
    # 2. Analyze T1 (Normal State)
    analyze_t1_res = send_request("POST", "/simulation/analyze", test_data["analyze_payload_t1"])
    
    # 3. Analyze T2 (Congested State)
    analyze_t2_res = send_request("POST", "/simulation/analyze", test_data["analyze_payload_t2_congested"])
    
    # 4. Clean up / End simulation
    delete_res = send_request("DELETE", f"/simulation/{test_data['init_payload']['simulationId']}")

    print("\n=== API TEST COMPLETE ===")

if __name__ == "__main__":
    main()
