import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { MapPin, Clock, Gauge } from 'lucide-react';

interface Vehicle {
  vehicleId: string;
  lat?: number;
  lng?: number;
  speed?: number;
  ts?: number;
  status: 'accepted' | 'pending';
}

interface VehicleListProps {
  vehicles: Vehicle[];
  onSelectVehicle: (vehicleId: string) => void;
  onRequestAccess?: (vehicleId: string) => void;
}

export const VehicleList = ({ vehicles, onSelectVehicle, onRequestAccess }: VehicleListProps) => {
  const formatTimestamp = (ts?: number) => {
    if (!ts) return 'N/A';
    const date = new Date(ts);
    return date.toLocaleTimeString();
  };

  return (
    <div className="space-y-3">
      {vehicles.length === 0 ? (
        <Card className="p-6 text-center">
          <MapPin className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
          <p className="text-muted-foreground">No vehicles available</p>
          {onRequestAccess && (
            <p className="text-sm text-muted-foreground mt-2">
              Request access to track vehicles
            </p>
          )}
        </Card>
      ) : (
        vehicles.map((vehicle) => (
          <Card
            key={vehicle.vehicleId}
            className="p-4 cursor-pointer hover:shadow-md transition-all"
            onClick={() => onSelectVehicle(vehicle.vehicleId)}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-semibold text-foreground">
                  Vehicle {vehicle.vehicleId}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {vehicle.status === 'accepted' ? 'Tracking active' : 'Pending access'}
                </p>
              </div>
              <Badge
                variant={vehicle.status === 'accepted' ? 'default' : 'secondary'}
                className={
                  vehicle.status === 'accepted'
                    ? 'bg-accent text-accent-foreground'
                    : 'bg-warning text-warning-foreground'
                }
              >
                {vehicle.status}
              </Badge>
            </div>

            {vehicle.status === 'accepted' && (
              <div className="space-y-2 text-sm">
                <div className="flex items-center text-muted-foreground">
                  <MapPin className="w-4 h-4 mr-2" />
                  {vehicle.lat != null && vehicle.lng != null
                    ? `${vehicle.lat.toFixed(4)}, ${vehicle.lng.toFixed(4)}`
                    : 'No location data'}
                </div>
                <div className="flex items-center text-muted-foreground">
                  <Gauge className="w-4 h-4 mr-2" />
                  {`${(vehicle.speed ?? 0).toFixed(0)} km/h`}
                </div>
                <div className="flex items-center text-muted-foreground">
                  <Clock className="w-4 h-4 mr-2" />
                  {formatTimestamp(vehicle.ts)}
                </div>
              </div>
            )}

            {vehicle.status === 'pending' && onRequestAccess && (
              <Button
                variant="outline"
                size="sm"
                className="w-full mt-2"
                onClick={(e) => {
                  e.stopPropagation();
                  onRequestAccess(vehicle.vehicleId);
                }}
              >
                Request Access
              </Button>
            )}
          </Card>
        ))
      )}
    </div>
  );
};
