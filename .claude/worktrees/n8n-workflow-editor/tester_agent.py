"""
tester_agent.py — Self-testing agent for the AI Voice Calling Agent project.

Runs automated health checks on both the backend (Python agents) and
frontend (Next.js dashboard), then generates a report.

Usage:
    python tester_agent.py              ← run all checks
    python tester_agent.py --backend    ← backend checks only
    python tester_agent.py --frontend   ← frontend checks only

The report is saved to logs/tester_report_<timestamp>.md
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

import json
import glob
import subprocess
import importlib
import re
from datetime import datetime
from pathlib import Path

# ── Constants ────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent
DASHBOARD_DIR = PROJECT_ROOT / "dashboard"
LOGS_DIR = PROJECT_ROOT / "logs"
DATA_DIR = PROJECT_ROOT / "data"

GREEN  = "\033[92m"
RED    = "\033[91m"
YELLOW = "\033[93m"
CYAN   = "\033[96m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

# ── Result tracking ──────────────────────────────────────────────────────────
results = []
errors_found = []
warnings_found = []


def log_check(name: str, passed: bool, detail: str = ""):
    icon = f"{GREEN}✅{RESET}" if passed else f"{RED}❌{RESET}"
    print(f"  {icon} {name}" + (f" — {detail}" if detail else ""))
    results.append({
        "name": name,
        "passed": passed,
        "detail": detail,
    })
    if not passed:
        errors_found.append(f"{name}: {detail}")


def log_warning(name: str, detail: str = ""):
    icon = f"{YELLOW}⚠️{RESET}"
    print(f"  {icon} {name}" + (f" — {detail}" if detail else ""))
    warnings_found.append(f"{name}: {detail}")


def section(title: str):
    print(f"\n{BOLD}{CYAN}{'─' * 60}{RESET}")
    print(f"{BOLD}{CYAN}  {title}{RESET}")
    print(f"{BOLD}{CYAN}{'─' * 60}{RESET}")


# =============================================================================
# BACKEND CHECKS
# =============================================================================

def check_backend_env():
    """Verify all required backend env vars are set."""
    section("Backend: Environment Variables")
    env_file = PROJECT_ROOT / ".env"

    if not env_file.exists():
        log_check(".env file exists", False, "Root .env file not found!")
        return

    log_check(".env file exists", True)

    # Parse .env manually (don't load it — just check keys exist)
    env_vars = {}
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                env_vars[key.strip()] = val.strip()

    required_vars = [
        "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
        "DEEPGRAM_API_KEY", "GROQ_API_KEY",
        "SARVAM_API_KEY", "VOBIZ_SIP_TRUNK_ID",
    ]

    for var in required_vars:
        val = env_vars.get(var, "")
        has_value = bool(val) and not val.startswith("your_")
        log_check(
            f"  {var}",
            has_value,
            "Missing or placeholder" if not has_value else ""
        )


def check_backend_imports():
    """Verify critical Python packages can be imported."""
    section("Backend: Python Imports")

    packages = [
        ("dotenv", "python-dotenv"),
        ("livekit", "livekit-agents"),
        ("certifi", "certifi"),
    ]

    for module_name, pip_name in packages:
        try:
            importlib.import_module(module_name)
            log_check(f"import {module_name}", True)
        except ImportError:
            log_check(f"import {module_name}", False, f"pip install {pip_name}")

    # Check groq separately (optional but important)
    try:
        importlib.import_module("groq")
        log_check("import groq", True)
    except ImportError:
        log_warning("import groq", "groq SDK not installed — analytics won't work")


def check_backend_configs():
    """Verify config files load without errors."""
    section("Backend: Configuration Files")

    # Check agent_config.json
    config_file = DATA_DIR / "agent_config.json"
    if config_file.exists():
        try:
            with open(config_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            has_outbound = "outbound" in data
            has_inbound = "inbound" in data
            log_check("agent_config.json is valid JSON", True)
            log_check("  has 'outbound' config", has_outbound,
                      "" if has_outbound else "Missing outbound configuration")
            log_check("  has 'inbound' config", has_inbound,
                      "" if has_inbound else "Missing inbound configuration")
        except json.JSONDecodeError as e:
            log_check("agent_config.json is valid JSON", False, str(e))
    else:
        log_warning("agent_config.json", "File not found — agents will use defaults")


    # Check agent scripts syntax
    for agent_name in ["agent_outbound.py", "agent_inbound.py"]:
        agent_path = PROJECT_ROOT / agent_name
        if agent_path.exists():
            try:
                with open(agent_path, "r", encoding="utf-8") as f:
                    compile(f.read(), agent_name, "exec")
                log_check(f"{agent_name} syntax OK", True)
            except SyntaxError as e:
                log_check(f"{agent_name} syntax OK", False, f"Line {e.lineno}: {e.msg}")
        else:
            log_check(f"{agent_name} exists", False, "File not found")


def check_backend_logs():
    """Scan recent log files for ERROR/CRITICAL patterns."""
    section("Backend: Log File Analysis")

    log_files = sorted(glob.glob(str(LOGS_DIR / "backend_*.log")), reverse=True)

    if not log_files:
        log_warning("No backend log files found", "Run 'python log_runner.py backend' to generate logs")
        return

    # Analyze most recent log
    latest = log_files[0]
    log_name = os.path.basename(latest)
    print(f"  📄 Analyzing: {log_name}")

    error_lines = []
    warning_lines = []
    total_lines = 0

    try:
        with open(latest, "r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, 1):
                total_lines += 1
                line_upper = line.upper()
                if "[ERROR]" in line_upper or "ERROR:" in line_upper or "CRITICAL" in line_upper:
                    error_lines.append((i, line.strip()[:120]))
                elif "[WARNING]" in line_upper or "WARN:" in line_upper:
                    warning_lines.append((i, line.strip()[:120]))
    except Exception as e:
        log_check(f"Read {log_name}", False, str(e))
        return

    log_check(
        f"  {log_name}: {total_lines} lines, {len(error_lines)} errors, {len(warning_lines)} warnings",
        len(error_lines) == 0,
        f"{len(error_lines)} error(s) found" if error_lines else "Clean ✨"
    )

    for line_num, content in error_lines[:5]:
        print(f"    {RED}Line {line_num}: {content}{RESET}")

    if len(error_lines) > 5:
        print(f"    {RED}... and {len(error_lines) - 5} more errors{RESET}")


# =============================================================================
# FRONTEND CHECKS
# =============================================================================

def check_frontend_env():
    """Verify dashboard .env.local has required vars."""
    section("Frontend: Environment Variables")
    env_file = DASHBOARD_DIR / ".env.local"

    if not env_file.exists():
        log_check(".env.local exists", False, "dashboard/.env.local not found!")
        return

    log_check(".env.local exists", True)

    env_vars = {}
    with open(env_file, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, val = line.partition("=")
                env_vars[key.strip()] = val.strip()

    required_vars = [
        "LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET",
        "GROQ_API_KEY", "NEXT_PUBLIC_BASE_URL",
    ]

    for var in required_vars:
        val = env_vars.get(var, "")
        has_value = bool(val) and not val.startswith("your_")
        log_check(
            f"  {var}",
            has_value,
            "Missing or placeholder" if not has_value else ""
        )


def check_frontend_dependencies():
    """Check if node_modules exists and package.json is valid."""
    section("Frontend: Dependencies")

    pkg_json = DASHBOARD_DIR / "package.json"
    if pkg_json.exists():
        try:
            with open(pkg_json, "r", encoding="utf-8") as f:
                data = json.load(f)
            log_check("package.json is valid", True)
            log_check(f"  Project: {data.get('name', 'unknown')}", True)
        except json.JSONDecodeError as e:
            log_check("package.json is valid", False, str(e))
    else:
        log_check("package.json exists", False, "Not found")

    node_modules = DASHBOARD_DIR / "node_modules"
    if node_modules.exists():
        log_check("node_modules/ exists", True)
    else:
        log_check("node_modules/ exists", False, "Run 'npm install' in dashboard/")


def check_frontend_typescript():
    """Run TypeScript type checking (non-blocking)."""
    section("Frontend: TypeScript Check")

    # Check if npx is available
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit", "--pretty"],
            cwd=str(DASHBOARD_DIR),
            capture_output=True,
            text=True,
            timeout=120,
            shell=True,
        )
        if result.returncode == 0:
            log_check("TypeScript compilation", True, "No type errors")
        else:
            # Count errors
            error_count = result.stdout.count("error TS")
            if error_count == 0:
                error_count = result.stderr.count("error TS")
            log_check(
                "TypeScript compilation",
                False,
                f"{error_count} type error(s) found"
            )
            # Show first few errors
            lines = (result.stdout or result.stderr).strip().split("\n")
            for line in lines[:8]:
                if "error TS" in line:
                    print(f"    {RED}{line.strip()[:120]}{RESET}")
    except subprocess.TimeoutExpired:
        log_warning("TypeScript check", "Timed out after 120s")
    except FileNotFoundError:
        log_warning("TypeScript check", "npx not found — skipping")
    except Exception as e:
        log_warning("TypeScript check", f"Failed: {e}")


def check_frontend_build():
    """Attempt a Next.js build to catch runtime errors."""
    section("Frontend: Build Check")

    print(f"  {YELLOW}⏳ Running next build (this may take 30-60s)...{RESET}")

    try:
        result = subprocess.run(
            ["npm", "run", "build"],
            cwd=str(DASHBOARD_DIR),
            capture_output=True,
            text=True,
            timeout=180,
            shell=True,
        )
        if result.returncode == 0:
            log_check("Next.js build", True, "Build succeeded ✨")
        else:
            # Extract meaningful error lines
            output = result.stdout + "\n" + result.stderr
            error_lines = [
                l.strip() for l in output.split("\n")
                if "error" in l.lower() or "Error" in l or "failed" in l.lower()
            ]
            log_check(
                "Next.js build",
                False,
                f"Build failed — {len(error_lines)} error line(s)"
            )
            for line in error_lines[:6]:
                print(f"    {RED}{line[:120]}{RESET}")
    except subprocess.TimeoutExpired:
        log_warning("Next.js build", "Timed out after 180s — build may be too slow")
    except FileNotFoundError:
        log_warning("Next.js build", "npm not found — skipping")
    except Exception as e:
        log_warning("Next.js build", f"Failed: {e}")


def check_frontend_logs():
    """Scan recent frontend log files for errors."""
    section("Frontend: Log File Analysis")

    log_files = sorted(glob.glob(str(LOGS_DIR / "frontend_*.log")), reverse=True)

    if not log_files:
        log_warning("No frontend log files found", "Run 'python log_runner.py frontend' to generate logs")
        return

    latest = log_files[0]
    log_name = os.path.basename(latest)
    print(f"  📄 Analyzing: {log_name}")

    error_lines = []
    warning_lines = []
    total_lines = 0

    try:
        with open(latest, "r", encoding="utf-8", errors="replace") as f:
            for i, line in enumerate(f, 1):
                total_lines += 1
                line_upper = line.upper()
                # Next.js specific error patterns
                if any(pat in line_upper for pat in ["ERROR", "FAILED", "UNHANDLED", "ERR!", "MODULE NOT FOUND"]):
                    error_lines.append((i, line.strip()[:120]))
                elif any(pat in line_upper for pat in ["WARN", "DEPRECAT"]):
                    warning_lines.append((i, line.strip()[:120]))
    except Exception as e:
        log_check(f"Read {log_name}", False, str(e))
        return

    log_check(
        f"  {log_name}: {total_lines} lines, {len(error_lines)} errors, {len(warning_lines)} warnings",
        len(error_lines) == 0,
        f"{len(error_lines)} error(s) found" if error_lines else "Clean ✨"
    )

    for line_num, content in error_lines[:5]:
        print(f"    {RED}Line {line_num}: {content}{RESET}")


# =============================================================================
# API ROUTE CHECKS
# =============================================================================

def check_api_routes():
    """Verify all API route files exist and are syntactically valid."""
    section("Frontend: API Routes")

    api_dir = DASHBOARD_DIR / "app" / "api"
    if not api_dir.exists():
        log_check("API routes directory", False, "dashboard/app/api/ not found")
        return

    expected_routes = [
        "agent-config", "auth", "copilot", "dispatch",
        "generate-workflow", "leads", "queue", "recordings", "send-email"
    ]

    for route in expected_routes:
        route_dir = api_dir / route
        if route_dir.exists():
            # Look for route.ts or route.tsx files
            route_files = list(route_dir.rglob("route.ts")) + list(route_dir.rglob("route.tsx"))
            if route_files:
                log_check(f"  /api/{route}", True, f"{len(route_files)} route file(s)")
            else:
                log_warning(f"  /api/{route}", "Directory exists but no route.ts/tsx found")
        else:
            log_check(f"  /api/{route}", False, "Route directory missing")


# =============================================================================
# REPORT GENERATION
# =============================================================================

def generate_report():
    """Save the test report to logs/tester_report_<timestamp>.md"""
    os.makedirs(LOGS_DIR, exist_ok=True)
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S")
    report_path = LOGS_DIR / f"tester_report_{timestamp}.md"

    passed = sum(1 for r in results if r["passed"])
    failed = sum(1 for r in results if not r["passed"])
    total = len(results)

    lines = [
        f"# Tester Agent Report — {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}",
        "",
        f"**Result: {passed}/{total} checks passed** | "
        f"{'✅ ALL CLEAR' if failed == 0 else f'❌ {failed} FAILED'}",
        "",
        "---",
        "",
    ]

    if errors_found:
        lines.append("## ❌ Errors")
        lines.append("")
        for err in errors_found:
            lines.append(f"- {err}")
        lines.append("")

    if warnings_found:
        lines.append("## ⚠️ Warnings")
        lines.append("")
        for warn in warnings_found:
            lines.append(f"- {warn}")
        lines.append("")

    lines.append("## All Checks")
    lines.append("")
    lines.append("| Status | Check | Detail |")
    lines.append("|--------|-------|--------|")
    for r in results:
        status = "✅" if r["passed"] else "❌"
        lines.append(f"| {status} | {r['name']} | {r['detail']} |")

    lines.append("")
    lines.append("---")
    lines.append(f"*Generated by tester_agent.py at {timestamp}*")

    with open(report_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))

    return report_path


# =============================================================================
# MAIN
# =============================================================================

def main():
    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  🧪 AI Voice Agent — Tester Agent{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")

    mode = sys.argv[1] if len(sys.argv) > 1 else "--all"

    run_backend = mode in ("--all", "--backend")
    run_frontend = mode in ("--all", "--frontend")

    if run_backend:
        check_backend_env()
        check_backend_imports()
        check_backend_configs()
        check_backend_logs()

    if run_frontend:
        check_frontend_env()
        check_frontend_dependencies()
        check_api_routes()
        check_frontend_typescript()
        check_frontend_logs()
        # Build check is slow — only run with --all or --frontend
        if mode == "--frontend":
            check_frontend_build()

    # ── Summary ──────────────────────────────────────────────────
    passed = sum(1 for r in results if r["passed"])
    failed = sum(1 for r in results if not r["passed"])
    total = len(results)

    print(f"\n{BOLD}{'═' * 60}{RESET}")
    if failed == 0:
        print(f"{GREEN}{BOLD}  ✅ ALL {total} CHECKS PASSED — System is healthy!{RESET}")
    else:
        print(f"{RED}{BOLD}  ❌ {failed}/{total} CHECKS FAILED{RESET}")
    if warnings_found:
        print(f"{YELLOW}  ⚠️  {len(warnings_found)} warning(s){RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")

    # Save report
    report_path = generate_report()
    print(f"\n  📋 Report saved to: {report_path}\n")

    # Exit with failure code if any checks failed
    sys.exit(1 if failed > 0 else 0)


if __name__ == "__main__":
    main()
