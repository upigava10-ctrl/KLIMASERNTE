"""Flask application factory for the model API."""

from flask import Flask
from werkzeug.middleware.proxy_fix import ProxyFix


try:
    from .routes import register_routes
except ImportError:
    from routes import register_routes


def create_app():
    app = Flask(__name__)

    app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1, x_host=1, x_prefix=1)
    register_routes(app)
    return app


