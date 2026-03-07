import RAPIER from "@dimforge/rapier3d-compat";

export interface DriveSimulationConfig {
  fromName: string;
  toName: string;
  distanceMiles: number;
  carName: string;
  speedMph: number;
  fuelGallons: number;
  mpg: number;
  dtSeconds?: number;
}

export interface DriveSimulationResult {
  ok: boolean;
  ticks: number;
  distanceReachedMiles: number;
  estimatedDurationMinutes: number;
  fuelUsedGallons: number;
  fuelLeftGallons: number;
  failureReason?: string;
}

const METERS_PER_MILE = 1609.34;

export async function runDriveSimulation(
  config: DriveSimulationConfig,
): Promise<DriveSimulationResult> {
  await RAPIER.init();

  const dtSeconds = config.dtSeconds ?? 5 / 60;
  const speedMps = (config.speedMph * METERS_PER_MILE) / 3600;
  const distanceMeters = config.distanceMiles * METERS_PER_MILE;

  const world = new RAPIER.World({ x: 0, y: 0, z: 0 });
  world.timestep = dtSeconds;

  const groundBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(2000, 0.5, 10), groundBody);

  const carBody = world.createRigidBody(
    RAPIER.RigidBodyDesc.dynamic().setTranslation(0, 0.5, 0),
  );
  world.createCollider(RAPIER.ColliderDesc.cuboid(1, 0.5, 2), carBody);
  carBody.setLinvel({ x: speedMps, y: 0, z: 0 }, true);

  let ticks = 0;
  let traveledMeters = 0;
  let lastX = carBody.translation().x;
  let fuelLeftGallons = config.fuelGallons;
  let failed = false;

  while (traveledMeters < distanceMeters) {
    world.step();
    ticks += 1;

    const currentX = carBody.translation().x;
    const stepTravelMeters = Math.max(0, currentX - lastX);
    lastX = currentX;
    traveledMeters += stepTravelMeters;

    const stepTravelMiles = stepTravelMeters / METERS_PER_MILE;
    fuelLeftGallons -= stepTravelMiles / config.mpg;

    if (fuelLeftGallons < 0) {
      failed = true;
      break;
    }
  }

  const estimatedDurationMinutes = (ticks * dtSeconds) / 60;
  const distanceReachedMiles = traveledMeters / METERS_PER_MILE;
  const fuelUsedGallons = config.fuelGallons - Math.max(fuelLeftGallons, 0);

  if (failed) {
    return {
      ok: false,
      ticks,
      distanceReachedMiles,
      estimatedDurationMinutes,
      fuelUsedGallons,
      fuelLeftGallons: Math.max(fuelLeftGallons, 0),
      failureReason: "not enough fuel",
    };
  }

  return {
    ok: true,
    ticks,
    distanceReachedMiles,
    estimatedDurationMinutes,
    fuelUsedGallons,
    fuelLeftGallons,
  };
}
