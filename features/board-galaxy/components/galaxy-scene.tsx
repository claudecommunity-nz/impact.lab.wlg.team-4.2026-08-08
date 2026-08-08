"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { useLayoutEffect, useMemo, useRef } from "react";
import { Color, InstancedMesh, Object3D } from "three";
import type { GalaxyGroup, GalaxyPoint } from "@/components/board/api-types";
import { groupColour } from "./galaxy-palette";

/** How far the normalised cloud reaches from the origin, in scene units. */
const CLOUD_EXTENT = 8;

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
    <Canvas camera={{ position: [12, 9, 14], fov: 50 }} dpr={[1, 2]}>
      <color attach="background" args={["#0b1017"]} />
      {/* Lit brightly and flatly on purpose: this is a data display, not a
          scene. Dramatic falloff makes the far half of the cloud unreadable,
          and a point an operator cannot see is a signal they do not have. */}
      <ambientLight intensity={2.4} />
      <directionalLight position={[10, 14, 12]} intensity={2.2} />
      <directionalLight position={[-12, -8, -10]} intensity={1.1} color="#5eead4" />

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
        enablePan
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={60}
      />
    </Canvas>
  );
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
): { points: PlacedPoint[]; groups: PlacedGroup[] } {
  const projected = points.filter(
    (point): point is GalaxyPoint & { x: number; y: number; z: number } =>
      point.x !== null && point.y !== null && point.z !== null,
  );

  const centres = groups.filter(
    (group): group is GalaxyGroup & { center: { x: number; y: number; z: number } } =>
      group.center !== null,
  );

  const coordinates = [
    ...projected.map((point) => [point.x, point.y, point.z] as const),
    ...centres.map((group) => [group.center.x, group.center.y, group.center.z] as const),
  ];

  if (coordinates.length === 0) return { points: [], groups: [] };

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

  return {
    points: projected.map((point) => ({
      signalId: point.signalId,
      groupId: point.groupId,
      ...place(point.x, point.y, point.z),
    })),
    groups: centres.map((group) => ({
      group,
      ...place(group.center.x, group.center.y, group.center.z),
      // Square-rooted so a cluster of 40 does not swallow the scene next to a
      // cluster of 4 — area reads as mass more honestly than radius does.
      radius: 0.5 + 2.2 * Math.sqrt(group.size / largest),
    })),
  };
}
