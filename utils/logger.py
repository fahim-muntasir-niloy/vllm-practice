"""Shared logger."""

import logging

logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s")

logger = logging.getLogger("vllm-app")
logger.setLevel(logging.INFO)
