# SDSU Fall 2026 Schedule Builder — Flask backend
#
# To run the development server:
#   cd my_app
#   pip install -r requirements.txt
#   python app.py
#
# The API will be available at http://localhost:5001
# Note: macOS reserves port 5000 for AirPlay Receiver.

import os
import csv
import math
from flask import Flask, jsonify, request, render_template
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAJOR_TO_SUBJECTS = {
    "Astronomy":        ["ASTR"],
    "Biology":          ["BIOL"],
    "Chemistry":        ["CHEM"],
    "Computer Science": ["CS", "CY"],
    "Geology":          ["GEOL"],
    "Math":             ["MATH"],
    "Physics":          ["PHYS"],
    "Psychology":       ["PSY"],
}

LEVEL_RANGE = {
    "grad":    (500, 799),
    "undergrad": (300, 499),
}

# Map query param values → Instruction Mode codes in the CSV
MODE_MAP = {
    "inperson": {"P", "HY"},   # P = in-person, HY = hybrid (has in-person component)
    "online":   {"ON", "OE"},  # ON = online, OE = online-evening
    "all":      {"P", "HY", "ON", "OE"},
}

# Day-code fragments that appear inside Standard Meeting Pattern strings
DAY_FRAGMENTS = {
    "M":  "M",
    "T":  "T",
    "W":  "W",
    "Th": "R",   # CSV uses R for Thursday
    "F":  "F",
    "S":  "S",
}

CSV_PATH = os.path.join(os.path.dirname(__file__), "data", "fallSchedule.csv")

# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def _safe_int(value: str) -> int | None:
    try:
        return int(str(value).strip())
    except (ValueError, TypeError):
        return None


def _safe_float(value: str) -> float | None:
    try:
        return float(str(value).strip())
    except (ValueError, TypeError):
        return None


def load_courses() -> list[dict]:
    courses = []
    with open(CSV_PATH, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row in reader:
            # Only active courses
            if row.get("Class Status", "").strip() != "A":
                continue

            catalog_raw = row.get("Catalog Nbr", "").strip()
            catalog_int = _safe_int(catalog_raw)

            facility = row.get("Facility ID", "").strip()
            instr_mode_raw = row.get("Instruction Mode", "").strip()

            instructor_last = row.get("Last Name", "").strip()
            instructor_init = row.get("Initials", "").strip()
            if instructor_last and instructor_init:
                instructor = f"{instructor_init}. {instructor_last}"
            elif instructor_last:
                instructor = instructor_last
            else:
                instructor = ""

            seats_cap = _safe_int(row.get("Enrollment Capacity", "")) or 0

            courses.append({
                "class_nbr":      _safe_int(row.get("Class Nbr", "")) or 0,
                "subject":        row.get("Subject", "").strip(),
                "catalog_nbr":    catalog_raw,
                "catalog_int":    catalog_int,
                "title":          row.get("Title", "").strip(),
                "instructor":     instructor,
                "units":          _safe_float(row.get("Component Units", "")) or 0.0,
                "days":           row.get("Standard Meeting Pattern", "").strip(),
                "start_time":     row.get("Meeting Start", "").strip(),
                "end_time":       row.get("Meeting End", "").strip(),
                "room":           facility,
                "mode":           instr_mode_raw,
                "seats_capacity": seats_cap,
                "seats_available": seats_cap,
                "component":      row.get("Component", "").strip(),
                "career":         row.get("Career", "").strip(),
            })
    return courses


# Load once at startup
ALL_COURSES: list[dict] = load_courses()


# ---------------------------------------------------------------------------
# Filtering helpers
# ---------------------------------------------------------------------------

def _matches_days(course_days: str, requested_days: list[str]) -> bool:
    """Return True if the course meets on at least one of the requested days."""
    if not requested_days:
        return True
    # Convert user-facing day codes to CSV day letters
    csv_day_letters = {DAY_FRAGMENTS[d] for d in requested_days if d in DAY_FRAGMENTS}
    if not csv_day_letters:
        return True
    # Thursday is encoded as "R" — check each requested letter individually
    for letter in csv_day_letters:
        if letter in course_days:
            return True
    return False


def _to_response(course: dict) -> dict:
    """Strip internal fields before returning to the client."""
    return {k: v for k, v in course.items() if k != "catalog_int"}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/majors")
def get_majors():
    return jsonify(sorted(MAJOR_TO_SUBJECTS.keys()))


@app.route("/api/courses")
def get_courses():
    major = request.args.get("major", "").strip()
    level = request.args.get("level", "").strip().lower()

    if not major:
        return jsonify({"error": "Missing required query parameter: major"}), 400
    if not level:
        return jsonify({"error": "Missing required query parameter: level"}), 400
    if major not in MAJOR_TO_SUBJECTS:
        return jsonify({"error": f"Unknown major '{major}'. Valid majors: {sorted(MAJOR_TO_SUBJECTS.keys())}"}), 400
    if level not in LEVEL_RANGE:
        return jsonify({"error": "Parameter 'level' must be 'grad' or 'undergrad'"}), 400

    mode_param = request.args.get("mode", "all").strip().lower()
    if mode_param not in MODE_MAP:
        return jsonify({"error": "Parameter 'mode' must be 'inperson', 'online', or 'all'"}), 400

    days_param = request.args.get("days", "").strip()
    requested_days: list[str] = []
    if days_param:
        requested_days = [d.strip() for d in days_param.split(",") if d.strip()]
        invalid_days = [d for d in requested_days if d not in DAY_FRAGMENTS]
        if invalid_days:
            return jsonify({"error": f"Invalid day code(s): {invalid_days}. Valid codes: {list(DAY_FRAGMENTS.keys())}"}), 400

    units_param = request.args.get("units", "").strip()
    units_filter: float | None = None
    if units_param:
        units_filter = _safe_float(units_param)
        if units_filter is None:
            return jsonify({"error": "Parameter 'units' must be a number"}), 400

    subjects = MAJOR_TO_SUBJECTS[major]
    lo, hi = LEVEL_RANGE[level]
    allowed_modes = MODE_MAP[mode_param]

    results = []
    for course in ALL_COURSES:
        if course["subject"] not in subjects:
            continue
        cat = course["catalog_int"]
        if cat is None or not (lo <= cat <= hi):
            continue
        if course["mode"] not in allowed_modes:
            continue
        if not _matches_days(course["days"], requested_days):
            continue
        if units_filter is not None and not math.isclose(course["units"], units_filter, rel_tol=1e-5):
            continue
        results.append(_to_response(course))

    return jsonify(results)


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    app.run(debug=True, port=5001)
