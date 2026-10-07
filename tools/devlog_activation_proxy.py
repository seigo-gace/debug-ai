#!/usr/bin/env python3
from __future__ import annotations
import re
import subprocess
import sys
from pathlib import Path

TGS_ROOT=Path("/home/admin1/projects/TGserver")
DEBUGAI_ROOT=Path("/home/admin1/projects/debug-ai")
HELPER_BRANCH="ops/canonical-devlog-runtime-readback-20261007"
HELPER_HEAD="0bbd3b2a6fa90f7f9ceca92945f28f482524b809"
HELPER_REL="scripts/canonical-devlog-runtime-activate.sh"
STATE_ROOT=DEBUGAI_ROOT/".debugai-input"
HELPER_FILE=STATE_ROOT/"canonical-devlog-runtime-activate.sh"
LOG_FILE=STATE_ROOT/"canonical-devlog-runtime-activate.log"
ISSUE_REPO="seigo-gace/TGserver"
ISSUE_NO="44"
SAFE_KEYS={
    "VERIFY","ERROR","TGS_BUILD","GATEWAY_BUILD","TGS_RUNTIME","GATEWAY_RUNTIME",
    "RUNTIME_STATE_PRESERVED","PRODUCER_GATEWAY_DURABLE","CANONICAL_EVENT_ID",
    "GATEWAY_EVENT_COUNT","GATEWAY_DELIVERY_COUNT","GATEWAY_OUTBOX_COUNT",
    "GATEWAY_DELIVERY_STATUS","BACKUP_DIR","SECRET_VALUE_EXPOSED","EXIT_CODE",
    "PROJECT_END"
}
SAFE_VALUE=re.compile(r"^[A-Za-z0-9_./:=,+-]{0,500}$")

def gh_comment(body: str) -> None:
    subprocess.run(
        ["gh","issue","comment",ISSUE_NO,"--repo",ISSUE_REPO,"--body",body],
        cwd=str(DEBUGAI_ROOT),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        timeout=20,
        check=False,
    )

def prepare_helper() -> None:
    subprocess.run(
        ["git","-C",str(TGS_ROOT),"fetch","--quiet","origin",HELPER_BRANCH],
        timeout=20,
        check=True,
    )
    actual=subprocess.check_output(
        ["git","-C",str(TGS_ROOT),"rev-parse","FETCH_HEAD"],
        text=True,
        timeout=5,
    ).strip()
    if actual != HELPER_HEAD:
        raise RuntimeError("HELPER_HEAD_MISMATCH")
    body=subprocess.check_output(
        ["git","-C",str(TGS_ROOT),"show",f"{HELPER_HEAD}:{HELPER_REL}"],
        timeout=10,
    )
    STATE_ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
    HELPER_FILE.write_bytes(body)
    HELPER_FILE.chmod(0o700)

def background() -> int:
    try:
        result=subprocess.run(
            ["bash",str(HELPER_FILE)],
            cwd=str(TGS_ROOT),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            timeout=1800,
            check=False,
        )
        raw=result.stdout or ""
        LOG_FILE.write_text(raw,encoding="utf-8")
        LOG_FILE.chmod(0o600)
        safe=[]
        for line in raw.splitlines():
            if "=" not in line:
                continue
            key,value=line.split("=",1)
            if key in SAFE_KEYS and SAFE_VALUE.fullmatch(value):
                safe.append(f"{key}={value}")
        if not any(x.startswith("VERIFY=") for x in safe):
            safe.append("VERIFY=FAIL")
            safe.append(f"ERROR=ACTIVATION_EXIT_{result.returncode}")
        body="Canonical DevLog activation result via existing DebugAI Server Command\n\n"
        body+=f"HELPER_HEAD={HELPER_HEAD}\n"
        body+="\n".join(safe[-30:])
        gh_comment(body)
        return 0
    except Exception as exc:
        code=type(exc).__name__.upper()
        gh_comment(
            "Canonical DevLog activation result via existing DebugAI Server Command\n\n"
            f"HELPER_HEAD={HELPER_HEAD}\nVERIFY=FAIL\nERROR=PROXY_{code}"
        )
        return 1

def dispatch() -> int:
    prepare_helper()
    gh_comment(
        "Canonical DevLog activation dispatched through existing DebugAI Server Command\n\n"
        f"HELPER_HEAD={HELPER_HEAD}\nSTATE=DISPATCHED"
    )
    subprocess.Popen(
        [sys.executable,str(Path(__file__).resolve()),"--background"],
        cwd=str(Path(__file__).resolve().parent),
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
    print("DEVLOG_ACTIVATION_DISPATCHED=YES")
    return 0

if __name__=="__main__":
    raise SystemExit(background() if "--background" in sys.argv[1:] else dispatch())
