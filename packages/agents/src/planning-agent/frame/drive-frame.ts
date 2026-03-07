export type LocationType = "place" | "gas_station";

export interface DriveLegResult {
  from: string;
  to: string;
  distanceMiles: number;
  fuelBefore: number;
  fuelAfter: number;
  refueledAtStart: boolean;
}

export interface ValidationResult {
  ok: boolean;
  failureReason?: string;
  legs: DriveLegResult[];
}

export interface DriveL1Args {
  driver: string;
  passengers: string[];
  vehicle: string;
  startLocation: string;
  destination: string;
  waypoints: string[];
}

export interface DriveL2Args {
  driver: string;
  passengers: string[];
  vehicle: VehicleL2;
  startLocation: Location;
  destination: Location;
  waypoints: Location[];
}

export class Location {
  public readonly id: string;
  public readonly name: string;
  public readonly type: LocationType;

  public constructor(id: string, name: string, type: LocationType) {
    if (!id.trim()) {
      throw new Error("Location.id must be non-empty.");
    }

    if (!name.trim()) {
      throw new Error("Location.name must be non-empty.");
    }

    this.id = id;
    this.name = name;
    this.type = type;
  }
}

export class VehicleL2 {
  public readonly make: string;
  public readonly model: string;
  public readonly fuelRangeMiles: number;

  public constructor(make: string, model: string, fuelRangeMiles: number) {
    if (fuelRangeMiles <= 0) {
      throw new Error("VehicleL2.fuelRangeMiles must be > 0.");
    }

    this.make = make;
    this.model = model;
    this.fuelRangeMiles = fuelRangeMiles;
  }
}

export class DriveL1 {
  public readonly driver: string;
  public readonly passengers: string[];
  public readonly vehicle: string;
  public readonly startLocation: string;
  public readonly destination: string;
  public readonly waypoints: string[];

  public constructor(args: DriveL1Args) {
    this.driver = args.driver;
    this.passengers = args.passengers;
    this.vehicle = args.vehicle;
    this.startLocation = args.startLocation;
    this.destination = args.destination;
    this.waypoints = args.waypoints;
  }
}

export class LocationResolver {
  private readonly locationsByName: Map<string, Location>;
  private readonly distances: Map<string, Map<string, number>>;
  private readonly vehiclesByName: Map<string, VehicleL2>;

  public constructor() {
    const locations = [
      new Location("home", "Home", "place"),
      new Location("waypoint-a", "Waypoint A", "place"),
      new Location("waypoint-b", "Waypoint B", "place"),
      new Location("campground", "Campground", "place"),
      new Location("gas-a", "Gas Station A", "gas_station"),
      new Location("gas-b", "Gas Station B", "gas_station"),
    ];

    this.locationsByName = new Map(locations.map((location) => [location.name, location]));
    this.distances = new Map();
    this.vehiclesByName = new Map([
      ["2016 Toyota Camry", new VehicleL2("Toyota", "Camry 2016", 120)],
    ]);

    this.addSymmetricDistance("Home", "Waypoint A", 120);
    this.addSymmetricDistance("Waypoint A", "Waypoint B", 70);
    this.addSymmetricDistance("Waypoint B", "Campground", 50);
    this.addSymmetricDistance("Waypoint A", "Gas Station A", 0);
    this.addSymmetricDistance("Gas Station A", "Waypoint B", 70);
    this.addSymmetricDistance("Waypoint B", "Gas Station B", 4);
    this.addSymmetricDistance("Gas Station B", "Campground", 86);
  }

  public resolveLocation(name: string): Location {
    const location = this.locationsByName.get(name);

    if (!location) {
      throw new Error(`Unknown location: "${name}"`);
    }

    return location;
  }

  public resolveVehicle(name: string): VehicleL2 {
    const vehicle = this.vehiclesByName.get(name);

    if (!vehicle) {
      throw new Error(`Unknown vehicle: "${name}"`);
    }

    return vehicle;
  }

  public distance(from: Location, to: Location): number {
    const row = this.distances.get(from.name);
    const distance = row?.get(to.name);

    if (distance === undefined) {
      throw new Error(`Missing distance for leg "${from.name}" -> "${to.name}"`);
    }

    return distance;
  }

  private addSymmetricDistance(from: string, to: string, miles: number): void {
    this.addDirectedDistance(from, to, miles);
    this.addDirectedDistance(to, from, miles);
  }

  private addDirectedDistance(from: string, to: string, miles: number): void {
    const row = this.distances.get(from) ?? new Map<string, number>();
    row.set(to, miles);
    this.distances.set(from, row);
  }
}

export class DriveL2 {
  public readonly driver: string;
  public readonly passengers: string[];
  public readonly vehicle: VehicleL2;
  public readonly startLocation: Location;
  public readonly destination: Location;
  public readonly waypoints: Location[];

  public constructor(args: DriveL2Args) {
    this.driver = args.driver;
    this.passengers = args.passengers;
    this.vehicle = args.vehicle;
    this.startLocation = args.startLocation;
    this.destination = args.destination;
    this.waypoints = args.waypoints;
  }

  public static fromL1(frame: DriveL1, resolver: LocationResolver): DriveL2 {
    return new DriveL2({
      driver: frame.driver,
      passengers: frame.passengers,
      vehicle: resolver.resolveVehicle(frame.vehicle),
      startLocation: resolver.resolveLocation(frame.startLocation),
      destination: resolver.resolveLocation(frame.destination),
      waypoints: frame.waypoints.map((name) => resolver.resolveLocation(name)),
    });
  }

  public route(): Location[] {
    return [this.startLocation, ...this.waypoints, this.destination];
  }

  public validateFuelFeasibility(resolver: LocationResolver): ValidationResult {
    const route = this.route();
    let fuelRemaining = this.vehicle.fuelRangeMiles;
    const legs: DriveLegResult[] = [];

    for (let index = 0; index < route.length - 1; index += 1) {
      const from = route[index];
      const to = route[index + 1];

      if (!from || !to) {
        throw new Error("Invalid route construction.");
      }

      const refueledAtStart = from.type === "gas_station";

      if (refueledAtStart) {
        fuelRemaining = this.vehicle.fuelRangeMiles;
      }

      const fuelBefore = fuelRemaining;
      const distanceMiles = resolver.distance(from, to);
      fuelRemaining -= distanceMiles;

      legs.push({
        from: from.name,
        to: to.name,
        distanceMiles,
        fuelBefore,
        fuelAfter: fuelRemaining,
        refueledAtStart,
      });

      if (fuelRemaining < 0) {
        return {
          ok: false,
          failureReason: `Ran out of fuel on leg ${from.name} -> ${to.name}. Needed ${distanceMiles} miles but had ${fuelBefore}.`,
          legs,
        };
      }
    }

    return { ok: true, legs };
  }
}
