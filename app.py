import os
from flask import Flask
from routes.views import views_bp
from routes.api import api_bp
from routes.support_reader import support_reader_bp
from routes.three_way_match import three_way_match_bp
from services.database import init_db

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "auditos-local-2024")
app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024

app.register_blueprint(views_bp)
app.register_blueprint(api_bp)
app.register_blueprint(support_reader_bp)
app.register_blueprint(three_way_match_bp)

init_db()

if __name__ == "__main__":
    print("\n  Audit Stack is running → http://localhost:5000\n")
    app.run(host="127.0.0.1", port=5000, debug=True)
