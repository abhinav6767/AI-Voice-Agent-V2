"""
run.py — Launch both outbound and inbound agents as separate processes, with full log capturing, summary generation, and auto-cleanup.

Usage:
    python run.py dev      ← development mode (with LiveKit dev server)
    python run.py start    ← production mode

Press Ctrl+C to stop both agents cleanly. On exit, a log summary is appended to the log file.
"""

import subprocess
import sys
import os
import time
import signal
from pathlib import Path
from datetime import datetime
from threading import Thread
from collections import defaultdict

# ── Constants & Config ────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent
LOGS_DIR = PROJECT_ROOT / "logs"

GREEN  = "\033[92m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
RED    = "\033[91m"
RESET  = "\033[0m"
BOLD   = "\033[1m"


def log(color: str, tag: str, msg: str):
    print(f"{color}{BOLD}[{tag}]{RESET} {msg}", flush=True)


# =============================================================================
# LOG CLEANUP & SUMMARY GENERATOR
# =============================================================================

def cleanup_old_logs():
    """Delete log and markdown report files older than 30 days (1 month)."""
    if not LOGS_DIR.exists():
        return
    now = time.time()
    one_month_seconds = 30 * 24 * 60 * 60
    deleted_count = 0
    for file_path in LOGS_DIR.iterdir():
        if file_path.is_file() and file_path.suffix in [".log", ".md"]:
            try:
                file_mtime = file_path.stat().st_mtime
                if (now - file_mtime) > one_month_seconds:
                    file_path.unlink()
                    deleted_count += 1
            except Exception as e:
                log(YELLOW, "CLEANUP", f"Failed to delete {file_path.name}: {e}")
    if deleted_count > 0:
        log(GREEN, "CLEANUP", f"Cleaned up {deleted_count} log/report files older than 1 month.")


def generate_summary(log_path: str, start_time: datetime):
    """Read the log file and append a summary section at the bottom."""
    end_time = datetime.now()
    duration = end_time - start_time
    hours, remainder = divmod(int(duration.total_seconds()), 3600)
    minutes, seconds = divmod(remainder, 60)
    duration_str = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

    error_lines = []
    warning_lines = []
    total_lines = 0
    error_categories = defaultdict(int)

    try:
        with open(log_path, "r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, 1):
                total_lines += 1
                line_stripped = line.strip()
                line_upper = line_stripped.upper()

                # Detect errors
                is_error = any(pat in line_upper for pat in [
                    "[ERROR]", "ERROR:", "CRITICAL:", "TRACEBACK",
                    "UNHANDLED", "EXCEPTION", "MODULE NOT FOUND",
                    "ERR!", "FAILED TO", "ECONNREFUSED", "ENOENT",
                ])
                if is_error and line_stripped:
                    error_lines.append((i, line_stripped[:150]))
                    # Categorize errors
                    if "TIMEOUT" in line_upper:
                        error_categories["Timeout"] += 1
                    elif "CONNECTION" in line_upper or "ECONNREFUSED" in line_upper:
                        error_categories["Connection"] += 1
                    elif "IMPORT" in line_upper or "MODULE" in line_upper:
                        error_categories["Import/Module"] += 1
                    elif "PERMISSION" in line_upper or "ACCESS" in line_upper:
                        error_categories["Permission"] += 1
                    elif "SYNTAX" in line_upper:
                        error_categories["Syntax"] += 1
                    else:
                        error_categories["Other"] += 1

                # Detect warnings
                is_warning = any(pat in line_upper for pat in [
                    "[WARNING]", "WARN:", "DEPRECAT", "⚠",
                ])
                if is_warning and not is_error and line_stripped:
                    warning_lines.append((i, line_stripped[:150]))

    except Exception as e:
        log(RED, "SUMMARY", f"Failed to read log file for summary: {e}")
        return

    # Build summary text
    summary_lines = [
        "",
        "",
        "═" * 70,
        f"BACKEND RUN SUMMARY — Generated at {end_time.strftime('%Y-%m-%d %H:%M:%S')}",
        "═" * 70,
        f"Total lines:    {total_lines:,}",
        f"Duration:       {duration_str}",
        f"Errors found:   {len(error_lines)}",
        f"Warnings found: {len(warning_lines)}",
        "",
    ]

    if error_lines:
        summary_lines.append("🔴 ERRORS:")
        if error_categories:
            summary_lines.append("  Categories:")
            for cat, count in sorted(error_categories.items(), key=lambda x: -x[1]):
                summary_lines.append(f"    - {cat}: {count}")
            summary_lines.append("")

        for line_num, content in error_lines[:20]:
            summary_lines.append(f"  Line {line_num}: {content}")
        if len(error_lines) > 20:
            summary_lines.append(f"  ... and {len(error_lines) - 20} more errors")
        summary_lines.append("")

    if warning_lines:
        summary_lines.append("⚠️ WARNINGS:")
        for line_num, content in warning_lines[:10]:
            summary_lines.append(f"  Line {line_num}: {content}")
        if len(warning_lines) > 10:
            summary_lines.append(f"  ... and {len(warning_lines) - 10} more warnings")
        summary_lines.append("")

    # Verdict
    if len(error_lines) == 0:
        verdict = "✅ NO ERRORS — Clean run"
    elif len(error_lines) <= 3:
        verdict = f"⚠️ {len(error_lines)} minor error(s) — review recommended"
    else:
        verdict = f"❌ {len(error_lines)} errors need attention"

    summary_lines.append(f"📋 VERDICT: {verdict}")
    summary_lines.append("═" * 70)
    summary_lines.append("")

    # Append summary to the log file
    try:
        with open(log_path, "a", encoding="utf-8") as f:
            f.write("\n".join(summary_lines))
        log(GREEN, "SUMMARY", f"Summary appended to {log_path}")
    except Exception as e:
        log(RED, "SUMMARY", f"Failed to write summary: {e}")

    # Also print summary to console
    for line in summary_lines:
        print(line)


# =============================================================================
# STREAM WRAPPER
# =============================================================================

def stream_output(pipe, log_file, prefix):
    """Read from process pipe and write to both console and log file with prefix."""
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            # Format output line
            formatted_line = f"{prefix} {line}"
            log_file.write(formatted_line)
            log_file.flush()
            sys.stdout.write(formatted_line)
            sys.stdout.flush()
    except (ValueError, OSError):
        pass


# =============================================================================
# MAIN RUNNER
# =============================================================================

def main():
    # Reconfigure stdout to support printing utf-8 characters (like Hindi) without crashing the console
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')

    mode = sys.argv[1] if len(sys.argv) > 1 else "start"
    cwd = Path(__file__).parent

    # Setup log directory and file
    os.makedirs(LOGS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = LOGS_DIR / f"backend_{timestamp}.log"
    start_time = datetime.now()

    # Clean up old logs on start
    cleanup_old_logs()

    log(BOLD, "RUN", f"Starting both agents in '{mode}' mode...")
    log(BOLD, "RUN", f"Logs will be saved to: {log_path}")
    print()

    processes = {}
    threads = []

    # Open log file to record stdout/stderr
    log_file = open(log_path, "w", encoding="utf-8")
    log_file.write(f"# Backend Log — {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
    log_file.write(f"# Command: python run.py {mode}\n")
    log_file.write(f"# Working Directory: {cwd}\n")
    log_file.write(f"{'─' * 70}\n\n")
    log_file.flush()

    def kill_port(port: int):
        """Kill any process listening on the given port (Windows-safe)."""
        try:
            result = subprocess.run(
                ["netstat", "-ano"],
                capture_output=True, text=True
            )
            for line in result.stdout.splitlines():
                if f":{port}" in line and "LISTENING" in line:
                    parts = line.strip().split()
                    pid = int(parts[-1])
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                                   capture_output=True)
                    log(YELLOW, "RUN", f"Killed stale PID {pid} on port {port}")
        except Exception as e:
            log(YELLOW, "RUN", f"Port {port} cleanup skipped: {e}")

    # Pre-flight: clear both agent ports before spawning
    log(CYAN, "RUN", "Clearing ports 8081 and 8082...")
    kill_port(8081)
    kill_port(8082)
    time.sleep(0.5)

    def spawn_process(name, script, color, port: int = 8081):
        prefix_ansi = f"{color}{BOLD}[{name.upper()}]{RESET}"
        log(color, name.upper(), f"Spawning {script} (port {port}) ...")
        
        env = os.environ.copy()
        env["PYTHONIOENCODING"] = "utf-8"
        # Note: agent port is set in WorkerOptions inside each agent file
        # (inbound=8082, outbound=8081) — not configurable via CLI or env var

        proc = subprocess.Popen(
            [sys.executable, "-u", script, mode],
            cwd=str(cwd),
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            encoding="utf-8",
            env=env
        )
        processes[name] = proc
        log(color, name.upper(), f"Started -> PID {proc.pid}")
        
        # Start a thread to read and write outputs
        t = Thread(
            target=stream_output,
            args=(proc.stdout, log_file, prefix_ansi),
            daemon=True
        )
        t.start()
        threads.append(t)
        return proc

    # Store port assignments for restart
    PORT_MAP = {"outbound": 8081, "inbound": 8082}

    try:
        # Spawn Outbound Agent on port 8081
        spawn_process("outbound", "agent_outbound.py", GREEN, port=8081)
        time.sleep(0.5)

        # Spawn Inbound Agent on port 8082 (avoids collision with outbound)
        spawn_process("inbound", "agent_inbound.py", CYAN, port=8082)

        print()
        log(BOLD, "RUN", f"Both agents running. Press {BOLD}Ctrl+C{RESET} to stop.")
        print()

        # Monitor processes and auto-restart if dead
        while True:
            time.sleep(2)
            for name, proc in list(processes.items()):
                ret = proc.poll()
                if ret is not None:
                    color = GREEN if name == "outbound" else CYAN
                    log(RED, name.upper(), f"Process exited with code {ret}. Restarting...")
                    script = f"agent_{name}.py"
                    spawn_process(name, script, color, port=PORT_MAP[name])

    except KeyboardInterrupt:
        print()
        log(YELLOW, "RUN", "Ctrl+C received — shutting down all agents...")
        _shutdown(processes)

    except Exception as e:
        log(RED, "RUN", f"Unexpected error: {e}")
        _shutdown(processes)

    finally:
        # Ensure outputs are flushed and file is closed before summary
        time.sleep(1.0)
        log_file.close()
        generate_summary(str(log_path), start_time)


def _shutdown(processes: dict):
    """Gracefully terminate all child processes."""
    for name, proc in processes.items():
        if proc.poll() is None:
            log(YELLOW, "RUN", f"Terminating {name} agent (PID {proc.pid})...")
            proc.terminate()

    deadline = time.time() + 5
    for name, proc in processes.items():
        remaining = max(0, deadline - time.time())
        try:
            proc.wait(timeout=remaining)
            log(YELLOW, "RUN", f"{name} agent stopped.")
        except subprocess.TimeoutExpired:
            log(RED, "RUN", f"{name} agent did not stop — force killing...")
            proc.kill()

    print()
    log(BOLD, "RUN", "All agents stopped. Goodbye!")


if __name__ == "__main__":
    main()
