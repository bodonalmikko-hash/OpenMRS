# Bahmni FHIR Atomfeed Listener

A Node.js service that automatically syncs Patient, Encounter, and Observation data from OpenMRS Atomfeed to HAPI FHIR server in Bahmni Lite.

## Overview

This service listens to OpenMRS Atomfeed endpoints for Patient, Encounter, and Observation updates, converts the data to FHIR R4 format, and automatically syncs it to the HAPI FHIR server. This enables real-time FHIR data availability for external systems.

## Architecture

```
OpenMRS (Atomfeed) → FHIR Atomfeed Listener → HAPI FHIR Server
```

The service:
1. Polls OpenMRS Atomfeed endpoints every 30 seconds
2. Fetches full resource data from OpenMRS REST API
3. Converts OpenMRS data to FHIR R4 format
4. Sends FHIR resources to HAPI FHIR server
5. Tracks last processed feed IDs to avoid duplicates

## Supported Resources

- **Patient**: Converts OpenMRS Patient to FHIR Patient resource
- **Encounter**: Converts OpenMRS Encounter to FHIR Encounter resource  
- **Observation**: Converts OpenMRS Obs to FHIR Observation resource

## Configuration

The service is configured via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENMRS_HOST` | OpenMRS server hostname | `openmrs` |
| `OPENMRS_PORT` | OpenMRS server port | `8080` |
| `OPENMRS_ATOMFEED_USER` | OpenMRS atomfeed username | `admin` |
| `OPENMRS_ATOMFEED_PASSWORD` | OpenMRS atomfeed password | `Admin123` |
| `FHIR_SERVER_URL` | HAPI FHIR server URL | `http://fhir-server:8080/fhir` |
| `PORT` | Service port | `3000` |
| `TZ` | Timezone | `UTC` |

## Integration Steps

### 1. Service Already Added to Docker Compose

The service has been automatically integrated into your Bahmni Lite setup:

- **Docker Compose**: Service added to `docker-compose.yml` under `fhir-atomfeed-listener`
- **Environment Variables**: Added to `.env` file
- **Profiles**: Configured for `emr` and `bahmni-lite` profiles

### 2. Start the Service

The service will start automatically when you run Bahmni Lite:

```bash
cd bahmni-lite
./run-bahmni.sh
```

Or using docker compose directly:

```bash
cd bahmni-lite
docker compose --env-file .env up -d
```

### 3. Verify Service is Running

Check that the service is running:

```bash
docker ps | grep fhir-atomfeed-listener
```

Check service health:

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "healthy",
  "lastProcessedIds": {
    "patient": "last-feed-id",
    "encounter": "last-feed-id", 
    "obs": "last-feed-id"
  }
}
```

### 4. View Logs

Monitor the service logs:

```bash
docker logs -f fhir-atomfeed-listener
```

## Testing

### Test Patient Sync

1. Create a new patient in OpenMRS via Bahmni UI
2. Wait up to 30 seconds for the next polling cycle
3. Check HAPI FHIR for the patient:

```bash
curl http://localhost:8085/fhir/Patient
```

### Test Encounter Sync

1. Create a new encounter in OpenMRS
2. Wait up to 30 seconds
3. Check HAPI FHIR for the encounter:

```bash
curl http://localhost:8085/fhir/Encounter
```

### Test Observation Sync

1. Create observations during an encounter
2. Wait up to 30 seconds
3. Check HAPI FHIR for observations:

```bash
curl http://localhost:8085/fhir/Observation
```

### Manual Trigger for Testing

To force an immediate sync, restart the service:

```bash
docker restart fhir-atomfeed-listener
```

## FHIR Resource Mapping

### Patient Mapping

| OpenMRS Field | FHIR Field |
|---------------|------------|
| uuid | id |
| identifier | identifier[0].value |
| givenName | name[0].given[0] |
| familyName | name[0].family |
| gender | gender (M→male, F→female) |
| birthdate | birthDate |
| voided | active (inverted) |
| personAddress.cityVillage | address[0].city |
| personAddress.stateProvince | address[0].state |
| personAddress.country | address[0].country |

### Encounter Mapping

| OpenMRS Field | FHIR Field |
|---------------|------------|
| uuid | id |
| patientUuid | subject.reference |
| patientName | subject.display |
| encounterDatetime | period.start/end |
| encounterType.uuid | type[0].coding[0].code |
| encounterType.name | type[0].coding[0].display |
| locationUuid | location[0].location.reference |

### Observation Mapping

| OpenMRS Field | FHIR Field |
|---------------|------------|
| uuid | id |
| personUuid | subject.reference |
| obsDatetime | effectiveDateTime |
| concept.uuid | code.coding[0].code |
| concept.name | code.coding[0].display |
| valueNumeric | valueQuantity.value |
| valueUnits | valueQuantity.unit |
| valueText | valueString |
| valueDatetime | valueDateTime |
| encounterUuid | encounter.reference |
| voided | status (voided→cancelled) |

## Troubleshooting

### Service Not Starting

Check if all dependencies are running:
```bash
docker ps | grep -E "openmrs|fhir-server"
```

Verify environment variables in `.env`:
```bash
cat .env | grep FHIR
```

### No Data Syncing

Check service logs for errors:
```bash
docker logs fhir-atomfeed-listener
```

Verify OpenMRS atomfeed is accessible:
```bash
curl -u admin:Admin123 http://localhost:8080/openmrs/ws/rest/v1/atomfeed/patient
```

Verify HAPI FHIR is accessible:
```bash
curl http://localhost:8085/fhir/metadata
```

### Authentication Errors

Verify OpenMRS credentials in `.env`:
```bash
OPENMRS_ATOMFEED_USER=admin
OPENMRS_ATOMFEED_PASSWORD=Admin123
```

### Network Issues

Ensure services can communicate:
```bash
docker exec fhir-atomfeed-listener ping openmrs
docker exec fhir-atomfeed-listener ping fhir-server
```

## Customization

### Change Polling Interval

Edit `index.js` and modify the interval:
```javascript
}, 30000); // Change 30000 to desired milliseconds
```

Rebuild the service:
```bash
docker compose build fhir-atomfeed-listener
docker compose up -d fhir-atomfeed-listener
```

### Add More Resource Types

1. Add endpoint to `ATOMFEED_ENDPOINTS` in `index.js`
2. Add conversion function for the new resource type
3. Add resource type to `RESOURCE_TYPE_MAP`
4. Rebuild and restart the service

### Modify FHIR Mappings

Edit the conversion functions in `index.js`:
- `convertPatientToFhir()`
- `convertEncounterToFhir()`
- `convertObsToFhir()`

## Performance Considerations

- The service polls every 30 seconds by default
- Large initial syncs may take time
- Consider increasing polling interval for high-volume systems
- Monitor HAPI FHIR server performance during initial sync

## Security

- The service uses OpenMRS atomfeed credentials from environment variables
- Ensure credentials are kept secure and not committed to version control
- The service communicates over internal Docker networks
- Consider adding TLS for production deployments

## Support

For issues specific to:
- **Bahmni Lite**: Check Bahmni documentation and community
- **HAPI FHIR**: Check HAPI FHIR documentation
- **OpenMRS Atomfeed**: Check OpenMRS module documentation

## Version Compatibility

- **Bahmni Lite**: v1.0.0
- **OpenMRS**: Compatible with Atomfeed module
- **HAPI FHIR**: R4 (latest)
- **Node.js**: 18+
