"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Object3D, type PerspectiveCamera } from "three";
import type { GalaxyGroup, GalaxyPoint } from "@/components/board/api-types";
import { groupColour } from "./galaxy-palette";

/** How far the normalised cloud reaches from the origin, in scene units. */
const CLOUD_EXTENT = 8;

/**
 * Module constants, NOT inline literals.
 *
 * `<Canvas dpr={[1, 2]}>` hands R3F a brand-new array on every render, and this
 * component re-renders on every three-second poll. That churn tore the renderer
 * down and rebuilt it repeatedly — fifty `THREE.Clock` deprecation warnings in
 * five minutes was the tell — and a canvas that is being recreated never gets
 * far enough to draw a frame, so it sits at its initial black clear with no
 * error anywhere. Imperative subsystems need referentially stable props.
 *
 * `camera` is gone for the same reason: CameraRig positions the default camera,
 * which is the only place the framing should be decided anyway.
 */
const DPR: [number, number] = [1, 2];
const BACKGROUND: [string] = ["#0b1017"];

type PlacedPoint = { signalId: string; groupId: string | null; x: number; y: number; z: number };
type PlacedGroup = { group: GalaxyGroup; x: number; y: number; z: number; radius: number };

/**
 * The semantic view: the same signals the map draws, positioned by what they
 * SAY rather than where they are. Two reports from opposite ends of the city
 * describing the same thing sit next to each other here and nowhere else.
 *
 * The three axes are a PCA squash of a 1536-dimension embedding, so distance is
 * meaningful and the axes themselves are not — which is why nothing in this
 * scene is labelled with a coordinate.
 *
 * Points whose `x/y/z` are null are SKIPPED, never drawn at the origin. The
 * projection basis is fitted once on the first 20+ embedded signals; before
 * that, and for anything ingested since the last `vectors.process` run, there
 * are honestly no coordinates, and piling those at the centre would draw a
 * dense cluster that does not exist. The count is reported instead.
 */
export function GalaxyScene({
  points,
  groups,
  selectedSignalId,
  onSelect,
}: {
  points: GalaxyPoint[];
  groups: GalaxyGroup[];
  selectedSignalId: string | null;
  onSelect: (signalId: string) => void;
}) {
  const scene = useMemo(() => layout(points, groups), [points, groups]);

  return (
    <Canvas dpr={DPR} frameloop="always">
      <color attach="background" args={BACKGROUND} />
      {/* Lit brightly and flatly on purpose: this is a data display, not a
          scene. Dramatic falloff makes the far half of the cloud unreadable,
          and a point an operator cannot see is a signal they do not have. */}
      <ambientLight intensity={2.4} />
      <directionalLight position={[10, 14, 12]} intensity={2.2} />
      <directionalLight position={[-12, -8, -10]} intensity={1.1} color="#5eead4" />

      <CameraRig radius={scene.radius} />

      <PointCloud points={scene.points} />

      {scene.groups.map((placed) => (
        <GroupBubble
          key={placed.group.id}
          placed={placed}
          selected={placed.group.id === selectedSignalId}
          onSelect={onSelect}
        />
      ))}

      <OrbitControls
        makeDefault
        target={[0, 0, 0]}
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={2}
        maxDistance={scene.radius * 12 + 20}
      />
    </Canvas>
  );
}

/**
 * Aims the camera at the cloud, and frames it.
 *
 * This is not a nicety. A fresh three.js camera has IDENTITY rotation: give it
 * a position and it still stares down -Z, so a scene sitting at the origin can
 * be entirely behind it — a correctly rendering canvas showing nothing but its
 * own background colour, with no error anywhere. That is exactly what happened
 * here, and a 4-unit test cube at the origin was invisible until this existed.
 *
 * Distance is derived from the cloud's own extent rather than hardcoded, so the
 * view stays framed whether the PCA basis puts the points in a unit ball or a
 * thousand units across.
 */
function CameraRig({ radius }: { radius: number }) {
  const camera = useThree((state) => state.camera) as PerspectiveCamera;

  useEffect(() => {
    // A single non-finite coordinate anywhere upstream would reach the camera
    // as a NaN position, and a NaN camera renders NOTHING — no geometry, not
    // even the scene's background colour, and no error. Refuse the update and
    // keep the last good framing instead.
    if (!Number.isFinite(radius) || radius <= 0) return;

    const distance = Math.max(radius * 2.6, 6);
    /* eslint-disable react-hooks/immutability -- A three.js camera is a mutable
       scene-graph object, not React state; driving it by assignment is how R3F
       is meant to be used. There is no immutable equivalent to reach for. */
    camera.position.set(distance * 0.55, distance * 0.42, distance * 0.72);
    camera.near = Math.max(distance / 200, 0.05);
    camera.far = distance * 20;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
    /* eslint-enable react-hooks/immutability */
  }, [camera, radius]);

  return null;
}

function PointCloud({ points }: { points: PlacedPoint[] }) {
  const meshRef = useRef<InstancedMesh>(null);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || points.length === 0) return;

    const transform = new Object3D();
    const colour = new Color();

    points.forEach((point, index) => {
      transform.position.set(point.x, point.y, point.z);
      transform.updateMatrix();
      mesh.setMatrixAt(index, transform.matrix);
      mesh.setColorAt(index, colour.set(groupColour(point.groupId)));
    });

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [points]);

  if (points.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, points.length]}>
      <sphereGeometry args={[0.2, 14, 14]} />
      {/* toneMapped={false} keeps the palette's hues exactly as the cluster
          list shows them — the two must agree at a glance. */}
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

function GroupBubble({
  placed,
  selected,
  onSelect,
}: {
  placed: PlacedGroup;
  selected: boolean;
  onSelect: (signalId: string) => void;
}) {
  const colour = groupColour(placed.group.id);

  const handleClick = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    onSelect(placed.group.id);
  };

  return (
    <mesh position={[placed.x, placed.y, placed.z]} onClick={handleClick}>
      <sphereGeometry args={[placed.radius, 28, 28]} />
      <meshBasicMaterial
        color={colour}
        transparent
        opacity={selected ? 0.42 : 0.2}
        depthWrite={false}
        toneMapped={false}
      />
    </mesh>
  );
}

// ─── internals ────────────────────────────────────────────────────────────────

/**
 * PCA coordinates have no fixed magnitude — they depend on the embedding spread
 * of whatever has been ingested — so the cloud is normalised into a fixed cube
 * before it is drawn. Points and bubble centres go through the SAME transform,
 * or the bubbles would float off their members.
 */
function layout(
  points: GalaxyPoint[],
  groups: GalaxyGroup[],
): { points: PlacedPoint[]; groups: PlacedGroup[]; radius: number } {
  const projected = points.filter(
    (point): point is GalaxyPoint & { x: number; y: number; z: number } =>
      Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z),
  );

  const centres = groups.filter(
    (group): group is GalaxyGroup & { center: { x: number; y: number; z: number } } =>
      group.center !== null &&
      Number.isFinite(group.center.x) &&
      Number.isFinite(group.center.y) &&
      Number.isFinite(group.center.z),
  );

  const coordinates = [
    ...projected.map((point) => [point.x, point.y, point.z] as const),
    ...centres.map((group) => [group.center.x, group.center.y, group.center.z] as const),
  ];

  if (coordinates.length === 0) return { points: [], groups: [], radius: CLOUD_EXTENT };

  const mean = [0, 1, 2].map(
    (axis) => coordinates.reduce((sum, value) => sum + value[axis], 0) / coordinates.length,
  );
  const reach = Math.max(
    ...coordinates.map((value) =>
      Math.max(...[0, 1, 2].map((axis) => Math.abs(value[axis] - mean[axis]))),
    ),
    1e-6,
  );
  const scale = CLOUD_EXTENT / reach;

  const place = (x: number, y: number, z: number) => ({
    x: (x - mean[0]) * scale,
    y: (y - mean[1]) * scale,
    z: (z - mean[2]) * scale,
  });

  const largest = Math.max(...groups.map((group) => group.size), 1);

  const placedGroups = centres.map((group) => ({
    group,
    ...place(group.center.x, group.center.y, group.center.z),
    // Square-rooted so a cluster of 40 does not swallow the scene next to a
    // cluster of 4 — area reads as mass more honestly than radius does.
    radius: 0.5 + 2.2 * Math.sqrt(group.size / largest),
  }));

  return {
    radius: placedGroups.reduce(
      (furthest, g) => Math.max(furthest, Math.hypot(g.x, g.y, g.z) + g.radius),
      CLOUD_EXTENT,
    ),
    groups: placedGroups,
    points: projected.map((point) => ({
      signalId: point.signalId,
      groupId: point.groupId,
      ...place(point.x, point.y, point.z),
    })),
  };
}
