# Eyewear AR

Virtual glasses try-on in the browser, from the webcam or a photo.
Face tracking by [MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker),
drawing by [Three.js](https://threejs.org). Nothing is sent to a server.

    pnpm install         # also copies the MediaPipe runtime and downloads the face model
    pnpm dev             # the demo app (camera works on localhost)
    pnpm dev:https       # port 5174 with a self-signed certificate, for a phone on the LAN
    pnpm build           # the demo app -> dist/
    pnpm build:lib       # only the core -> dist-lib/eyewear-ar.js (global EyewearAR) and .mjs

## The demo app

React, Tailwind and shadcn/ui around the core:

- **Camera**, **Photo** and **Reference head** (the glasses on MediaPipe's
  model face, turned with sliders, no camera needed)
- **Frames**: the models listed in `models.json` at `VITE_MODELS_URL` (a Vercel
  Blob store; without it, `public/models/`), plus your own `.glb`
  (button or drag and drop), with a model check against the convention below
- **Settings**: every part of the core can be switched live: debug head (wire
  or solid), live measurements, hiding behind the head, face shadow, matching
  the picture, fit to the face, true size from the iris, GPU or CPU
- **How it works**: what each part does

URL switches: `?model=<id>`, `?photo=<url>`, `?view=reference`, `?debug`
(or `?debug=solid`), `?fit=0`, `?iris=0`, `?shadow=0`, `?match=0`,
`?occlusion=0`, `?delegate=CPU`.

## The core

`src/core/` has no framework dependency:

    const tryOn = new EyewearAR.TryOn(element, {
      wasmPath: '/mediapipe/wasm',
      modelPath: '/mediapipe/face_landmarker.task',
    })
    await tryOn.setGlasses('/models/my-frame.glb')
    await tryOn.startCamera()                      // or tryOn.showPhoto(fileOrUrl)
    await tryOn.update({ debug: 'solid', faceShadow: false })   // settings, live

- `tracking.ts`: `FaceTracker`: video frame or image in, `GlassesPose` out
  (placement, true-size scale from the iris, fit to the face shape, smoothing)
- `renderer.ts`: `GlassesRenderer`: Three.js scene with the camera MediaPipe
  assumes, the invisible head occluder, lighting, face shadow, temple fitting
- `lighting.ts`: reads brightness and colour of the picture to light the glasses the same way
- `TryOn.ts`: `TryOn`: ready-made widget (mirrored webcam or photo) for an element

## Model convention

Glasses models are GLB files in metres, Y up, front facing +Z, origin at the
centre of the bridge. Temples may be separate meshes named `temple_left` and
`temple_right` with their origin at the hinge, so they can swing to the ears
and fade behind the head. Meshes whose name starts with `lens` get the lens material.

## How placement works

FaceLandmarker's facial transformation matrix maps MediaPipe's canonical face
(centimetres) into the space of a fixed virtual camera: 63 degrees vertical
field of view, aspect ratio of the image, looking down -Z. The scene is drawn
with exactly that camera, in centimetres, so the overlay lines up with the
picture. A model is scaled by 100 and moved to the point on the nose where a
bridge rests (`BRIDGE_ANCHOR_CM`), the same for every model.

The matrix assumes every face has the size of the canonical face. The real
size comes from the iris (11.7 mm in adults): `faceScale` in the pose.
