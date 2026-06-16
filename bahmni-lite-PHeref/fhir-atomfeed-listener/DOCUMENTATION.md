# Bahmni FHIR Event Listener

A service that automatically syncs patient data from Bahmni Lite to HAPI FHIR server. This listener watches for changes in Bahmni's database and keeps your FHIR server up-to-date with the latest patient information.

## What This Does

When you create or update patients in Bahmni Lite, this service picks up those changes and sends the data to your HAPI FHIR server. It handles:

- Patient records (names, addresses, contact info, demographics)
- Encounter data (visits, appointments)
- Observations (lab results, vitals, clinical notes)

The sync happens automatically in the background - you don't need to do anything manually after the initial setup.

## How It Works

This service uses Bahmni's event system instead of the traditional OpenMRS atomfeed. Here's the flow:

1. **Database Polling**: Every 30 seconds, the service checks Bahmni's `event_records` table for new changes
2. **Data Fetching**: When it finds new events, it fetches the complete patient data from OpenMRS REST API
3. **FHIR Conversion**: Converts OpenMRS data format to FHIR R4 standard
4. **Sync to HAPI**: Sends the converted data to your HAPI FHIR server
5. **Tracking**: Keeps track of which events have been processed to avoid duplicates

## Installation

### Prerequisites

- Docker and Docker Compose installed
- Bahmni Lite running with MySQL database
- HAPI FHIR server running
- Network access between all services

### Setup Steps

1. **Add to Docker Compose**
   
   The service is already included in your `docker-compose.yml` file. It depends on:
   - `openmrs` (for REST API access)
   - `fhir-server` (HAPI FHIR)
   - `openmrsdb` (for event polling)

2. **Configure Environment Variables**
   
   Add these to your `.env` file:
   ```bash
   # FHIR Server Configuration
   FHIR_SERVER_URL=http://fhir-server:8080/fhir
   FHIR_ATOMFEED_LISTENER_PORT=3001
   
   # OpenMRS Configuration
   OPENMRS_HOST=openmrs
   OPENMRS_PORT=8080
   OPENMRS_ATOMFEED_USER=admin
   OPENMRS_ATOMFEED_PASSWORD=Admin123
   
   # Database Configuration
   DB_HOST=openmrsdb
   DB_PORT=3306
   DB_USER=openmrs-user
   DB_PASSWORD=password
   DB_NAME=openmrs
   ```

3. **Start the Service**
   ```bash
   docker compose up -d fhir-atomfeed-listener
   ```

4. **Verify It's Running**
   ```bash
   docker logs fhir-atomfeed-listener
   ```
   
   You should see messages like:
   ```
   Starting Bahmni FHIR Event Listener...
   OpenMRS: http://openmrs:8080
   FHIR Server: http://fhir-server:8080/fhir
   Database: openmrsdb:3306/openmrs
   ```

## For Users

### Checking Sync Status

You can check if the service is healthy by visiting:
```
http://localhost:3001/health
```

This returns the last processed event IDs for each resource type.

### Verifying Data in HAPI FHIR

Use Postman or any HTTP client to check if patient data has synced:

**Get All Patients:**
```
GET http://localhost:8085/fhir/Patient
```

**Get Specific Patient:**
```
GET http://localhost:8085/fhir/Patient/{patient-id}
```

**Search by Identifier:**
```
GET http://localhost:8085/fhir/Patient?identifier={patient-identifier}
```

### What Gets Synced

When a patient is created or updated in Bahmni, the following data syncs to FHIR:

- **Basic Info**: Patient ID, gender, birth date, age
- **Names**: Given names, middle name, family name
- **Contact**: Email addresses, phone numbers
- **Address**: Street address, city, state, postal code
- **Identifiers**: Medical record numbers and other IDs

### Troubleshooting Common Issues

**Service won't start:**
- Check if all dependent services are running
- Verify database credentials in `.env`
- Check Docker logs: `docker logs fhir-atomfeed-listener`

**Patients not appearing in FHIR:**
- Wait 30-60 seconds for the next polling cycle
- Check if there are new events in the database
- Verify HAPI FHIR server is accessible
- Look for errors in the listener logs

**Data looks incomplete:**
- The service only syncs what's available in OpenMRS
- Some fields might be empty in the source system
- Check the conversion logic in `index.js` if you need to add more fields

## For Developers

### Project Structure

```
fhir-atomfeed-listener/
├── index.js          # Main application logic
├── package.json      # Node.js dependencies
├── Dockerfile        # Container build instructions
└── DOCUMENTATION.md  # This file
```

### Key Components

**Database Connection (`getDbConnection`)**
- Creates MySQL connection to Bahmni database
- Uses credentials from environment variables
- Handles connection cleanup

**Event Polling (`queryNewEvents`)**
- Queries `event_records` table for new events
- Filters by resource type (patient, encounter, obs)
- Returns events with ID greater than last processed

**Data Conversion Functions**
- `convertPatientToFhir`: Converts OpenMRS patient to FHIR Patient
- `convertEncounterToFhir`: Converts OpenMRS encounter to FHIR Encounter  
- `convertObsToFhir`: Converts OpenMRS observation to FHIR Observation

**FHIR Sync (`sendToFhir`)**
- Attempts to update existing resources first
- Creates new resources if they don't exist (404)
- Handles FHIR validation errors

### Adding New Resource Types

To support additional OpenMRS resources:

1. **Add to Configuration**
   ```javascript
   const lastProcessedEventIds = {
     patient: 0,
     encounter: 0,
     obs: 0,
     your_new_type: 0  // Add this
   };
   ```

2. **Create Conversion Function**
   ```javascript
   function convertYourTypeToFhir(openmrsData) {
     return {
       resourceType: 'YourFHIRType',
       id: openmrsData.uuid,
       // Add your field mappings
     };
   }
   ```

3. **Update Conversion Switch**
   ```javascript
   function convertToFhir(resourceType, openmrsData) {
     switch (resourceType) {
       // existing cases...
       case 'your_new_type':
         return convertYourTypeToFhir(openmrsData);
     }
   }
   ```

### Customizing Field Mappings

The current patient conversion includes common fields. To add more:

Edit the `convertPatientToFhir` function in `index.js`:

```javascript
// Example: Adding custom attribute
if (person.attributes && Array.isArray(person.attributes)) {
  person.attributes.forEach(attr => {
    if (attr.attributeType.display === 'Your Custom Field') {
      fhirPatient.yourCustomField = attr.value;
    }
  });
}
```

### Debugging

**Enable Detailed Logging:**
The service logs important operations. For more detail, you can add console.log statements in the code.

**Check Database Events:**
```bash
docker exec bahmni-lite-openmrsdb-1 mysql -u openmrs-user -ppassword openmrs \
  -e "SELECT * FROM event_records ORDER BY id DESC LIMIT 10;"
```

**Test FHIR Conversion:**
Add temporary logging in the conversion function to see the FHIR output:
```javascript
console.log('FHIR output:', JSON.stringify(fhirPatient, null, 2));
```

### Performance Considerations

- **Polling Interval**: Currently set to 30 seconds. Adjust in `startPolling()` function if needed
- **Batch Size**: Limited to 100 events per polling cycle to prevent memory issues
- **Database Connections**: Connections are closed after each query to prevent connection pool exhaustion

### Error Handling

The service includes error handling at multiple levels:

1. **Database Errors**: Logged but don't stop the service
2. **API Errors**: Retries on network failures, logs validation errors
3. **Conversion Errors**: Skips problematic events but continues processing
4. **FHIR Errors**: Detailed error logging for troubleshooting

### Testing Locally

To test without Docker:

1. **Install Dependencies**
   ```bash
   cd fhir-atomfeed-listener
   npm install
   ```

2. **Set Environment Variables**
   ```bash
   export OPENMRS_HOST=localhost
   export OPENMRS_PORT=8080
   export DB_HOST=localhost
   # ... other variables
   ```

3. **Run Directly**
   ```bash
   node index.js
   ```

## Architecture Notes

### Why Bahmni Events Instead of Atomfeed?

Standard OpenMRS installations use atomfeed for change tracking, but Bahmni Lite uses its own event system stored in the `event_records` table. This service was adapted to work with Bahmni's architecture instead of the traditional atomfeed endpoints.

### Data Flow

```
Bahmni UI → OpenMRS Database → event_records Table → 
Listener Polling → OpenMRS REST API → FHIR Conversion → 
HAPI FHIR Server
```

### Database Schema

The service queries the `event_records` table with these key fields:
- `id`: Auto-incrementing event ID
- `uuid`: Unique event identifier
- `category`: Resource type (patient, encounter, obs, etc.)
- `object`: REST API path to the resource
- `timestamp`: When the event occurred

## Support and Contributing

If you encounter issues or want to extend this service:

1. Check the logs first - most issues are logged with detailed error messages
2. Verify your environment variables match your actual setup
3. Test database connectivity directly
4. Check that HAPI FHIR server is accepting requests

For major changes or additions, consider:
- Adding configuration options instead of hardcoding values
- Including error recovery mechanisms
- Adding health checks for external dependencies
- Documenting any new features in this file

## Version History

- **v1.0**: Initial implementation with Bahmni event system support
- **v1.1**: Enhanced patient data conversion (names, addresses, contacts)
- **v1.2**: Fixed date formatting for FHIR compatibility
- **v1.3**: Added comprehensive error logging and debugging support
