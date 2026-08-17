"""Physical helpers shared by the synthetic generator, clustering, and tracker.

Deep-water group velocity: Cg ~= 1.56 * T (m/s), per §4.5 of the master plan.
"""
import math

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


def bearing_deg(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def destination_point(lat, lon, bearing, distance_km):
    """Project a point forward along a great-circle bearing (degrees) by distance_km."""
    delta = distance_km / EARTH_RADIUS_KM
    theta = math.radians(bearing)
    phi1, lambda1 = math.radians(lat), math.radians(lon)
    phi2 = math.asin(
        math.sin(phi1) * math.cos(delta) + math.cos(phi1) * math.sin(delta) * math.cos(theta)
    )
    lambda2 = lambda1 + math.atan2(
        math.sin(theta) * math.sin(delta) * math.cos(phi1),
        math.cos(delta) - math.sin(phi1) * math.sin(phi2),
    )
    return math.degrees(phi2), (math.degrees(lambda2) + 540) % 360 - 180


def group_velocity_kmh(period_s):
    """Deep-water group velocity, Cg ~= 1.56 * T, converted to km/h."""
    return 1.56 * period_s * 3.6


def great_circle_point(lat1, lon1, lat2, lon2, dist_from_start_km, total_dist_km):
    """Point at dist_from_start_km along the great circle from (lat1,lon1)
    toward (lat2,lon2), where total_dist_km is the great-circle distance
    between those two anchor points. Allows dist_from_start_km > total_dist_km
    (extrapolates straight on past the second anchor along the same track)."""
    delta = total_dist_km / EARTH_RADIUS_KM
    f = dist_from_start_km / total_dist_km
    phi1, lam1 = math.radians(lat1), math.radians(lon1)
    phi2, lam2 = math.radians(lat2), math.radians(lon2)
    a = math.sin((1 - f) * delta) / math.sin(delta)
    b = math.sin(f * delta) / math.sin(delta)
    x = a * math.cos(phi1) * math.cos(lam1) + b * math.cos(phi2) * math.cos(lam2)
    y = a * math.cos(phi1) * math.sin(lam1) + b * math.cos(phi2) * math.sin(lam2)
    z = a * math.sin(phi1) + b * math.sin(phi2)
    phi_i = math.atan2(z, math.sqrt(x * x + y * y))
    lam_i = math.atan2(y, x)
    return math.degrees(phi_i), math.degrees(lam_i)


def direction_to_vector(direction_from_deg):
    """Unit vector for the direction swell is TRAVELLING (i.e. direction_from + 180)."""
    travel_deg = (direction_from_deg + 180) % 360
    rad = math.radians(travel_deg)
    return math.sin(rad), math.cos(rad)  # (east-component, north-component)


def angular_diff(a, b):
    """Smallest difference between two compass angles, in degrees, always >= 0."""
    d = abs(a - b) % 360
    return min(d, 360 - d)
