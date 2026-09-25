import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BeadMotion, createBeadGeometry } from '../src/beads.js';

test('beads have an open through-hole, tall walls, and rounded rims', () => {
  const geometry=createBeadGeometry();
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.max.z-geometry.boundingBox.min.z>1.1);
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  mesh.updateMatrixWorld();
  const ray=new THREE.Raycaster(new THREE.Vector3(0,0,3),new THREE.Vector3(0,0,-1));
  assert.equal(ray.intersectObject(mesh).length,0,'The hole must be actual empty geometry');
  ray.set(new THREE.Vector3(.35,0,3),new THREE.Vector3(0,0,-1));
  assert.ok(ray.intersectObject(mesh).length>0,'The rim is solid');
});

test('replacement lifts, swaps at the apex, and lands before the next replacement', () => {
  const mesh=new THREE.InstancedMesh(createBeadGeometry(),new THREE.MeshBasicMaterial(),1);
  const red=new THREE.Color('red'), blue=new THREE.Color('blue'), green=new THREE.Color('green');
  mesh.setColorAt(0,red);
  const motion=new BeadMotion(mesh,{columns:1,rows:1,spacing:.9,height:1});
  motion.setTarget(0,red);motion.settle();
  const matrix=new THREE.Matrix4(), color=new THREE.Color();
  const z=()=>{mesh.getMatrixAt(0,matrix);return matrix.elements[14];};
  const rgb=()=>{mesh.getColorAt(0,color);return color.getHexString();};
  const resting=z();
  motion.setTarget(0,blue);motion.update(1);motion.update(1.04);
  assert.ok(z()>resting,'Old bead lifts off the peg');
  assert.equal(rgb(),red.getHexString(),'Old color stays during removal');
  motion.setTarget(0,green);motion.update(1.13);
  assert.equal(rgb(),blue.getHexString(),'An incoming frame does not interrupt replacement');
  motion.update(1.20);
  assert.ok(Math.abs(z()-resting)<.001,'Replacement lands fully');
  motion.update(1.4);
  assert.equal(rgb(),green.getHexString(),'The most recent pending frame is eventually applied');
  assert.ok(Math.abs(z()-resting)<.001);
  motion.setTarget(0,red);motion.enabled=false;motion.update(1.5);
  assert.equal(rgb(),red.getHexString(),'Disabling motion applies exact frame colors immediately');
  assert.ok(Math.abs(z()-resting)<.001);
});
