import {
  DriveL1,
  DriveL2,
  type DriveL1Args,
  LocationResolver,
  type ValidationResult,
} from "../frame";

export interface DrivePlanSummary {
  route: string[];
  validation: ValidationResult;
}

export function buildDrivePlan(
  args: DriveL1Args,
  resolver = new LocationResolver(),
): { frameL1: DriveL1; frameL2: DriveL2; summary: DrivePlanSummary } {
  const frameL1 = new DriveL1(args);
  const frameL2 = DriveL2.fromL1(frameL1, resolver);
  const validation = frameL2.validateFuelFeasibility(resolver);

  return {
    frameL1,
    frameL2,
    summary: {
      route: frameL2.route().map((location) => location.name),
      validation,
    },
  };
}
