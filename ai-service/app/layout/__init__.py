"""Layout → graph pipeline.

Turns an uploaded 2D floor plan into the canonical ``VenueGraph`` the simulation runs
on. See ``docs/layout-pipeline.md`` for the stage order and the VRAM budget that
dictates it.

Deliberately empty of imports: ``app.layout.pipeline`` pulls in OpenCV and NumPy, and
those are optional extras (``requirements-layout.txt``). Importing them here would make
``app.main`` fail to start whenever the layout deps are absent, which is exactly the
coupling the split requirements files exist to prevent.
"""
