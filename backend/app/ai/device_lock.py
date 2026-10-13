import threading

# One lock for every model call on the accelerator.
#
# FastAPI runs requests in parallel threads (e.g. surface
# detection in the background while the user draws a
# polygon). PyTorch's MPS backend is not thread-safe:
# two threads encoding GPU work at once abort the whole
# process ("A command encoder is already encoding to
# this command buffer"). Every model forward pass holds
# this lock, so requests take turns per model call
# rather than waiting for a whole request.
#
# Re-entrant, because SAMService.box_candidates holds it
# while calling set_image, which takes it again.
inference_lock = threading.RLock()
