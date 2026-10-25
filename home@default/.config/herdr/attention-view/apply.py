#!/usr/bin/env python3
import json
import os
import socket
import sys


def main():
    request = {
        "id": "attention-view",
        "method": "agent.view.set",
        "params": {
            "source": "plugin:asonas.attention-view",
            "label": "attention",
            "filter": {"op": "in", "field": "status", "values": ["blocked", "done"]},
            "sort": [
                {"field": "attention", "order": "desc"},
                {"field": "pane_order", "order": "asc"},
            ],
        },
    }
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(5)
        connection.connect(os.environ["HERDR_SOCKET_PATH"])
        connection.sendall((json.dumps(request) + "\n").encode())
        with connection.makefile("r", encoding="utf-8") as reader:
            response = json.loads(reader.readline())
    if "error" in response:
        sys.exit(f"Cannot restore attention view: {response['error']}")
    if not response.get("result", {}).get("active"):
        sys.exit("Herdr did not activate the attention view")
    print("Attention view active: blocked, done")


if __name__ == "__main__":
    main()
