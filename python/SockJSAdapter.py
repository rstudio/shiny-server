import sys

# This needs to be very early, dependency loading can fail
python_version = (
    f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
)
print(f"Using Python {python_version} at {sys.executable}", file=sys.stderr)

import os
import importlib
import json
from typing import TypedDict, cast, List, Optional, Literal
from xmlrpc.client import boolean
import uvicorn
from asgiref.typing import (
    ASGI3Application,
    Scope,
    ASGIReceiveCallable,
    ASGISendCallable,
    ASGISendEvent,
)
from starlette.responses import PlainTextResponse

if sys.version_info >= (3, 8):
    from importlib import metadata
else:
    import importlib_metadata as metadata


class ShinyInput(TypedDict):
    appDir: str
    port: str
    sharedSecret: str
    reconnect: boolean
    disableProtocols: List[str]
    gaTrackingId: Optional[str]
    shinyServerVersion: str
    workerId: str
    mode: Literal["shiny-python"]
    pandocPath: str
    logFilePath: str
    sanitizeErrors: boolean
    bookmarkStateDir: Optional[str]


# Do not allow any HTTP or WebSocket requests to succeed unless the
# shiny-shared-secret header is present and has the correct value
class SharedSecretMiddleware:
    def __init__(self, app: ASGI3Application, sharedSecret: str):
        self.app = app
        self.sharedSecret: bytes = sharedSecret.encode("utf-8")

    async def __call__(
        self, scope: Scope, receive: ASGIReceiveCallable, send: ASGISendCallable
    ) -> None:
        if not self.check_secret(scope):
            resp = cast(
                ASGI3Application,
                PlainTextResponse(
                    "Direct access to this content is not permitted.", 403
                ),
            )
            return await resp(scope, receive, send)

        await self.app(scope, receive, send)

    def check_secret(self, scope: Scope) -> boolean:
        # We're only responsible for securing HTTP and WebSocket
        if not scope["type"] == "http" and not scope["type"] == "websocket":
            return True

        # name and value are bytes, not strings
        for [name, value] in scope["headers"]:
            if name == b"shiny-shared-secret":
                if value == self.sharedSecret:
                    return True
                break
        return False


class ShinyInjectHeadMiddleware:
    def __init__(self, app: ASGI3Application, input: ShinyInput):
        self.app = app

        reconnect = "true" if input["reconnect"] else "false"
        if input["disableProtocols"] and len(input["disableProtocols"]) > 0:
            disable_protocols = '"' + '","'.join(input["disableProtocols"]) + '"'
        else:
            disable_protocols = ""

        gaTrackingCode = ""
        if input["gaTrackingId"]:
            gaID = input["gaTrackingId"]
            if gaID[:3] == "UA-":
                # Deprecated Google Analytics with Universal Analytics ID
                gaTrackingCode = """
                    <script type="text/javascript">

                    var _gaq = _gaq || [];
                    _gaq.push(['_setAccount', '{0}']);
                    _gaq.push(['_trackPageview']);

                    (function() {{
                        var ga = document.createElement('script'); ga.type = 'text/javascript'; ga.async = true;
                        ga.src = ('https:' == document.location.protocol ? 'https://ssl' : 'http://www') + '.google-analytics.com/ga.js';
                        var s = document.getElementsByTagName('script')[0]; s.parentNode.insertBefore(ga, s);
                    }})();

                    </script>
                    """.format(
                    gaID
                )
            else:
                gaTrackingCode = """
                    <!-- Google tag (gtag.js) -->
                    <script async src=\"https://www.googletagmanager.com/gtag/js?id=%s\"></script>
                    <script>
                    window.dataLayer = window.dataLayer || [];
                    function gtag(){dataLayer.push(arguments);}
                    gtag('js', new Date());
                    gtag('config', '%s');
                    </script>
                    """.format(
                    gaID, gaID
                )

        self.script = """  <script src="__assets__/sockjs.min.js"></script>
    <script src="__assets__/shiny-server-client.min.js"></script>
    <script>preShinyInit({{reconnect:{0},disableProtocols:[{1}]}});</script>
    <link rel="stylesheet" type="text/css" href="__assets__/shiny-server.css">{2}
  </head>
        """.format(
            reconnect, disable_protocols, gaTrackingCode
        ).encode(
            "ascii"
        )

    async def __call__(
        self, scope: Scope, receive: ASGIReceiveCallable, send: ASGISendCallable
    ) -> None:
        if scope["type"] != "http" or scope["path"] != "/":
            return await self.app(scope, receive, send)

        intercept = True
        body = b""

        async def sockjs_send(event: ASGISendEvent) -> None:
            nonlocal intercept
            nonlocal body

            if intercept:
                if event["type"] == "http.response.start":
                    if event["status"] != 200:
                        intercept = False
                    # Must remove Content-Length, if present; if we insert our
                    # scripts, it won't be correct anymore
                    event["headers"] = [
                        (name, value)
                        for (name, value) in event["headers"]
                        if name.decode("ascii").lower() != "content-length"
                    ]
                elif event["type"] == "http.response.body":
                    body += event["body"]
                    if b"</head>" in body:
                        event["body"] = body.replace(b"</head>", self.script)
                        body = b""  # Allow gc
                        intercept = False
                    elif event["more_body"]:
                        # DO NOT send the response; wait for more data
                        return
                    else:
                        # The entire response was seen, and we never encountered
                        # any </head>. Just send everything we have
                        event["body"] = body
                        body = b""  # Allow gc

            return await send(event)

        await self.app(scope, receive, sockjs_send)


def wrap_shiny_app(app: ASGI3Application, input: ShinyInput) -> ASGI3Application:
    app = SharedSecretMiddleware(app, input["sharedSecret"])
    app = ShinyInjectHeadMiddleware(app, input)
    return app


def run():
    shiny_output = {
        "pid": os.getpid(),
        "versions": {
            "python": f"{python_version} ({sys.executable})",
            "shiny": metadata.version("shiny"),
        },
    }
    print("shiny_launch_info: " + json.dumps(shiny_output, indent=None))
    print("==END==")

    input: ShinyInput = json.load(sys.stdin)

    if input["logFilePath"] != "":
        log_file_handle = open(input["logFilePath"], "w")
        sys.stderr = log_file_handle

    if input["sanitizeErrors"]:
        os.environ["SHINY_SANITIZE_ERRORS"] = "1"

    if input["pandocPath"] != "":
        os.environ["RSTUDIO_PANDOC"] = input["pandocPath"]

    sys.path.insert(0, input["appDir"])
    app_module = importlib.import_module("app")
    app = getattr(app_module, "app")

    app = wrap_shiny_app(app, input)

    uvicorn.run(app, host="127.0.0.1", port=int(input["port"]))


run()
