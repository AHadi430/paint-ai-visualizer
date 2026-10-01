"""
Upload the backend to a Hugging Face Docker Space.

Run by .github/workflows/deploy-backend.yml with the assembled Space
folder as the only argument. Configuration comes from environment
variables (GitHub secrets / variables):

    HF_TOKEN           Hugging Face token with write access (secret)
    HF_SPACE           Space id, e.g. "your-name/paint-ai-visualizer"
    ACCESS_PASSWORD    Password users must enter (secret, required)
    CORS_ORIGINS       Comma-separated allowed sites (optional)
    CORS_ORIGIN_REGEX  Regex for allowed sites, e.g. Vercel (optional)
"""

import os
import sys

from huggingface_hub import HfApi


def main() -> None:

    folder = sys.argv[1]
    space = os.environ["HF_SPACE"]
    token = os.environ.get("HF_TOKEN", "")
    password = os.environ.get("ACCESS_PASSWORD", "")

    if not token:
        sys.exit(
            "HF_TOKEN is not set. Add a Hugging Face token with write "
            "access as a GitHub secret: gh secret set HF_TOKEN"
        )

    # The Space must be public so the website can reach it, so
    # never deploy it without a password.
    if not password:
        sys.exit(
            "ACCESS_PASSWORD is not set. Add it as a GitHub secret "
            "before deploying, otherwise anyone could use the API."
        )

    api = HfApi(token=token)

    api.create_repo(
        space,
        repo_type="space",
        space_sdk="docker",
        private=False,
        exist_ok=True,
    )

    # Runtime configuration (read by backend/app/config.py).
    api.add_space_secret(space, "ACCESS_PASSWORD", password)

    for name in ("CORS_ORIGINS", "CORS_ORIGIN_REGEX"):
        value = os.environ.get(name, "")
        if value:
            api.add_space_variable(space, name, value)

    sha = os.environ.get("GITHUB_SHA", "")[:7]

    api.upload_folder(
        folder_path=folder,
        repo_id=space,
        repo_type="space",
        commit_message=f"Deploy {sha}".strip(),
        # Mirror backend/: remove files deleted in GitHub.
        delete_patterns=["backend/**"],
    )

    owner, name = space.split("/")
    host = f"{owner}-{name}".lower().replace("_", "-").replace(".", "-")

    print(f"Deployed. API URL: https://{host}.hf.space")


if __name__ == "__main__":
    main()
