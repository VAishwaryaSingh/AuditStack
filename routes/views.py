from flask import Blueprint, render_template, redirect, url_for
from services.database import get_sessions

views_bp = Blueprint("views", __name__)

@views_bp.route("/")
def index():
    return redirect(url_for("views.risk_assessment"))

@views_bp.route("/risk-assessment")
def risk_assessment():
    sessions = get_sessions()
    return render_template("risk_assessment.html", sessions=sessions)
