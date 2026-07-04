"""
log_runner.py — Captures all stdout/stderr to timestamped log files with auto-generated summaries.

Usage:
    python log_runner.py backend     ← runs python run.py dev with logging
    python log_runner.py frontend    ← runs npm run dev (in dashboard/) with logging

Logs are saved to:
    logs/backend_YYYY-MM-DD_HH-MM-SS.log
    logs/frontend_YYYY-MM-DD_HH-MM-SS.log

Each log file ends with an auto-generated summary section that highlights
errors, warnings, and an overall verdict.

Press Ctrl+C to stop — the summary is generated on exit.
"""

import os
import sys

# Force UTF-8 output on Windows (prevents charmap encoding errors)
if sys.platform == "win32":
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except AttributeError:
        pass

import subprocess
import signal
import re
import time
from datetime import datetime
from pathlib import Path
from threading import Thread
from collections import defaultdict

# ── Constants ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"
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
# LOG SUMMARY GENERATOR
# =============================================================================

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
        log(RED, "SUMMARY", f"Failed to read log file: {e}")
        return

    # Build summary text
    summary_lines = [
        "",
        "",
        "═" * 70,
        f"LOG SUMMARY — Generated at {end_time.strftime('%Y-%m-%d %H:%M:%S')}",
        "═" * 70,
        f"Total lines:    {total_lines:,}",
        f"Duration:       {duration_str}",
        f"Errors found:   {len(error_lines)}",
        f"Warnings found: {len(warning_lines)}",
        "",
    ]

    if error_lines:
        summary_lines.append("🔴 ERRORS:")
        # Show error category breakdown
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
# STREAM READER — captures subprocess output to both console and file
# =============================================================================

def stream_output(pipe, log_file, prefix=""):
    """Read from a pipe and write to both console and log file."""
    try:
        for line in iter(pipe.readline, ""):
            if not line:
                break
            log_file.write(line)
            log_file.flush()
            # Also print to console with optional prefix
            sys.stdout.write(f"{prefix}{line}")
            sys.stdout.flush()
    except (ValueError, OSError):
        # Pipe closed
        pass


# =============================================================================
# RUNNERS
# =============================================================================

def run_backend():
    """Run python run.py dev and capture output."""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = LOGS_DIR / f"backend_{timestamp}.log"
    start_time = datetime.now()

    log(CYAN, "LOG_RUNNER", f"Starting backend (python run.py dev)...")
    log(CYAN, "LOG_RUNNER", f"Log file: {log_path}")
    print()

    os.makedirs(LOGS_DIR, exist_ok=True)

    with open(log_path, "w", encoding="utf-8") as log_file:
        # Write header
        log_file.write(f"# Backend Log — {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_file.write(f"# Command: python run.py dev\n")
        log_file.write(f"# Working Directory: {PROJECT_ROOT}\n")
        log_file.write(f"{'─' * 70}\n\n")
        log_file.flush()

        try:
            proc = subprocess.Popen(
                [sys.executable, "run.py", "dev"],
                cwd=str(PROJECT_ROOT),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
            )

            # Stream output in a thread
            reader = Thread(
                target=stream_output,
                args=(proc.stdout, log_file),
                daemon=True,
            )
            reader.start()

            # Wait for Ctrl+C
            proc.wait()

        except KeyboardInterrupt:
            log(YELLOW, "LOG_RUNNER", "Ctrl+C received — stopping backend...")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

        except Exception as e:
            log(RED, "LOG_RUNNER", f"Error: {e}")
            log_file.write(f"\n[LOG_RUNNER ERROR] {e}\n")

        # Wait for reader thread to finish
        time.sleep(0.5)

    # Generate summary
    generate_summary(str(log_path), start_time)


def run_frontend():
    """Run npm run dev (in dashboard/) and capture output."""
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    log_path = LOGS_DIR / f"frontend_{timestamp}.log"
    start_time = datetime.now()

    log(CYAN, "LOG_RUNNER", f"Starting frontend (npm run dev)...")
    log(CYAN, "LOG_RUNNER", f"Log file: {log_path}")
    print()

    os.makedirs(LOGS_DIR, exist_ok=True)

    with open(log_path, "w", encoding="utf-8") as log_file:
        # Write header
        log_file.write(f"# Frontend Log — {start_time.strftime('%Y-%m-%d %H:%M:%S')}\n")
        log_file.write(f"# Command: npm run dev\n")
        log_file.write(f"# Working Directory: {DASHBOARD_DIR}\n")
        log_file.write(f"{'─' * 70}\n\n")
        log_file.flush()

        try:
            proc = subprocess.Popen(
                ["npx", "next", "dev"],
                cwd=str(DASHBOARD_DIR),
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1,
                shell=True,
            )

            # Stream output
            reader = Thread(
                target=stream_output,
                args=(proc.stdout, log_file),
                daemon=True,
            )
            reader.start()

            # Wait for Ctrl+C
            proc.wait()

        except KeyboardInterrupt:
            log(YELLOW, "LOG_RUNNER", "Ctrl+C received — stopping frontend...")
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()

        except Exception as e:
            log(RED, "LOG_RUNNER", f"Error: {e}")
            log_file.write(f"\n[LOG_RUNNER ERROR] {e}\n")

        time.sleep(0.5)

    # Generate summary
    generate_summary(str(log_path), start_time)


# =============================================================================
# LOG CLEANUP
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


# =============================================================================
# MAIN
# =============================================================================

def main():
    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  📋 AI Voice Agent — Log Runner{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}\n")

    # Clean up old logs on startup
    cleanup_old_logs()

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python log_runner.py backend     ← capture backend logs")
        print("  python log_runner.py frontend    ← capture frontend logs")
        print()
        sys.exit(1)

    mode = sys.argv[1].lower()

    if mode == "backend":
        run_backend()
    elif mode == "frontend":
        run_frontend()
    else:
        log(RED, "LOG_RUNNER", f"Unknown mode: {mode}")
        print("  Use 'backend' or 'frontend'")
        sys.exit(1)

    print()
    log(GREEN, "LOG_RUNNER", "Done. Check the logs/ folder for your log file.")


if __name__ == "__main__":
    main()
