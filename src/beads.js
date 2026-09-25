import * as THREE from 'three';

// A closed, hollow plastic tube. The profile keeps a flat rim and rounds only
// its edges; a torus or a bevelled flat ring does not have the same silhouette.
export function createBeadGeometry() {
  const profile = [
    [.445, 0], [.473, .018], [.485, .05], [.485, 1.10],
    [.474, 1.133], [.449, 1.15], [.269, 1.15],
    [.241, 1.132], [.23, 1.10], [.23, .05], [.24, .018], [.269, 0], [.445, 0],
  ].map(([radius, height]) => new THREE.Vector2(radius, height));
  const geometry = new THREE.LatheGeometry(profile, 20);
  geometry.rotateX(Math.PI / 2);
  // Baked cavity occlusion complements the moving, real-time shadows. The
  // opening remains hollow: no dark disk is used to fake the hole.
  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let i = 0; i < positions.count; i++) {
    const radius = Math.hypot(positions.getX(i), positions.getY(i));
    const height = positions.getZ(i) / 1.15;
    const inner = radius < .255;
    const shade = inner ? .31 + .56 * height : .80 + .20 * height;
    colors.set([shade, shade, shade], i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

export class BeadMotion {
  constructor(mesh, { columns, rows, spacing, height }) {
    this.mesh = mesh;
    this.columns = columns;
    this.rows = rows;
    this.spacing = spacing;
    this.height = height;
    this.step = 96 / columns;
    this.targets = new Float32Array(mesh.count * 3);
    this.inFlight = new Float32Array(mesh.count * 3);
    this.started = new Float64Array(mesh.count).fill(-1);
    this.object = new THREE.Object3D();
    this.initialized = false;
    this.enabled = true;
    this.duration = .19;
    for (let i = 0; i < mesh.count; i++) this.place(i, 0);
  }

  place(i, phase) {
    const seed = ((i * 127.1) % 71) / 71;
    // Pull the old bead off the peg, remove it at the apex, then place the
    // replacement from above. No rubbery vertical stretching of the tube.
    let lift = 0, size = 1;
    if (phase > 0 && phase < 1) {
      if (phase < .45) {
        const t = phase / .45;
        lift = t * t * 2.35;
        size = 1 - THREE.MathUtils.smoothstep(t, .72, 1);
      } else {
        const t = (phase - .45) / .55;
        lift = 2.35 * (1 - t) ** 2;
        size = THREE.MathUtils.smoothstep(t, 0, .22);
      }
    }
    const x = i % this.columns, y = Math.floor(i / this.columns);
    const wobble = Math.sin(phase * Math.PI) * .085;
    this.object.position.set(
      (x - (this.columns - 1) / 2) * this.step,
      ((this.rows - 1) / 2 - y) * this.step,
      .025 + lift * this.step * this.height,
    );
    this.object.rotation.set(wobble * (seed - .5), wobble * .6, seed * .06);
    const diameter = this.step * this.spacing * Math.max(size, .001);
    this.object.scale.set(diameter, diameter, this.step * this.height * Math.max(size, .001));
    this.object.updateMatrix();
    this.mesh.setMatrixAt(i, this.object.matrix);
  }

  setTarget(i, color) {
    this.targets.set([color.r, color.g, color.b], i * 3);
  }

  settle() {
    this.mesh.instanceColor.array.set(this.targets);
    for (let i = 0; i < this.mesh.count; i++) this.place(i, 0);
    this.started.fill(-1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
    this.initialized = true;
  }

  update(now) {
    if (!this.initialized || !this.enabled) {
      this.settle();
      return;
    }
    const current = this.mesh.instanceColor.array;
    let moved = false, recolored = false;
    for (let i = 0; i < this.mesh.count; i++) {
      const offset = i * 3;
      if (this.started[i] >= 0) {
        const phase = THREE.MathUtils.clamp((now - this.started[i]) / this.duration, 0, 1);
        this.place(i, phase);
        moved = true;
        if (phase >= .45) {
          current.set(this.inFlight.subarray(offset, offset + 3), offset);
          recolored = true;
        }
        if (phase >= 1) this.started[i] = -1;
      }
      if (this.started[i] < 0) {
        const difference = Math.abs(current[offset] - this.targets[offset])
          + Math.abs(current[offset + 1] - this.targets[offset + 1])
          + Math.abs(current[offset + 2] - this.targets[offset + 2]);
        if (difference > .012) {
          // Coalesce updates during a replacement so fast video cannot keep
          // restarting a bead in midair. Each bead always finishes landing.
          this.inFlight.set(this.targets.subarray(offset, offset + 3), offset);
          this.started[i] = now + ((i * 13) % 17) / 16 * this.duration * .15;
        } else if (difference > 0) {
          current.set(this.targets.subarray(offset, offset + 3), offset);
          recolored = true;
        }
      }
    }
    if (moved) this.mesh.instanceMatrix.needsUpdate = true;
    if (recolored) this.mesh.instanceColor.needsUpdate = true;
  }
}
