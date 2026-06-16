const axios = require('axios');
const mysql = require('mysql2/promise');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration from environment variables
const OPENMRS_HOST = process.env.OPENMRS_HOST || 'openmrs';
const OPENMRS_PORT = process.env.OPENMRS_PORT || '8080';
const OPENMRS_USER = process.env.OPENMRS_ATOMFEED_USER || 'admin';
const OPENMRS_PASSWORD = process.env.OPENMRS_ATOMFEED_PASSWORD || 'Admin123';
const FHIR_SERVER_URL = process.env.FHIR_SERVER_URL || 'http://fhir-server:8080/fhir';

// Database configuration for Bahmni event system
const DB_HOST = process.env.DB_HOST || 'openmrsdb';
const DB_PORT = process.env.DB_PORT || '3306';
const DB_USER = process.env.DB_USER || 'openmrs-user';
const DB_PASSWORD = process.env.DB_PASSWORD || 'password';
const DB_NAME = process.env.DB_NAME || 'openmrs';

// Track last processed event IDs for each resource type
const lastProcessedEventIds = {
  patient: 0,
  encounter: 0,
  obs: 0
};

// FHIR resource type mapping
const RESOURCE_TYPE_MAP = {
  patient: 'Patient',
  encounter: 'Encounter',
  obs: 'Observation'
};

/**
 * Create database connection
 */
async function getDbConnection() {
  return await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME
  });
}

/**
 * Query Bahmni event_records table for new events
 */
async function queryNewEvents(resourceType) {
  const connection = await getDbConnection();
  try {
    const lastId = lastProcessedEventIds[resourceType];
    
    // Query event_records for relevant resource types
    // Map resource types to event categories
    const categoryMap = {
      patient: 'patient',
      encounter: 'encounter', 
      obs: 'obs'
    };
    
    const category = categoryMap[resourceType];
    
    const query = `
      SELECT id, uuid, title, timestamp, uri, object, category, date_created
      FROM event_records
      WHERE LOWER(category) = ? AND id > ?
      ORDER BY id ASC
      LIMIT 100
    `;
    
    const [rows] = await connection.execute(query, [category, lastId]);
    return rows;
  } finally {
    await connection.end();
  }
}

/**
 * Convert OpenMRS Patient to FHIR Patient
 */
function convertPatientToFhir(openmrsPatient) {
  // Check if patient data exists
  if (!openmrsPatient) {
    throw new Error('Patient data is undefined');
  }
  
  // Extract person data from nested structure
  const person = openmrsPatient.person || openmrsPatient;
  
  // Format birthDate to FHIR standard (YYYY-MM-DD)
  let formattedBirthDate = null;
  if (person.birthdate) {
    const birthDate = new Date(person.birthdate);
    if (!isNaN(birthDate.getTime())) {
      formattedBirthDate = birthDate.toISOString().split('T')[0];
    }
  }
  
  const fhirPatient = {
    resourceType: 'Patient',
    id: openmrsPatient.uuid || openmrsPatient.patientId || 'unknown',
    meta: {
      profile: ['https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-patient']
    },
    language: 'en',
    identifier: [],
    name: [],
    gender: person.gender === 'M' ? 'male' : person.gender === 'F' ? 'female' : 'unknown',
    birthDate: formattedBirthDate,
    active: !openmrsPatient.voided,
    telecom: [],
    address: [],
    extension: []
  };

  // Add identifiers
  if (openmrsPatient.identifiers && Array.isArray(openmrsPatient.identifiers)) {
    openmrsPatient.identifiers.forEach(id => {
      const identifierObj = {
        use: id.preferred ? 'official' : 'usual',
        type: {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'MR'
          }]
        },
        value: id.identifier
      };
      
      // Add PH Core profile for PhilHealth ID
      if (id.identifierType && id.identifierType.name && id.identifierType.name.toLowerCase().includes('philhealth')) {
        identifierObj.type = {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'PH',
            display: 'PhilHealth ID'
          }]
        };
        identifierObj.system = 'https://fhir.doh.gov.ph/identifier/philhealth';
        identifierObj.assigner = {
          reference: 'Organization/philhealth',
          display: 'PhilHealth'
        };
        identifierObj.extension = [{
          url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/identifier-location',
          valueString: 'PhilHealth'
        }];
      }
      
      // Add PH Core profile for PhilSys ID
      if (id.identifierType && id.identifierType.name && id.identifierType.name.toLowerCase().includes('philsys')) {
        identifierObj.type = {
          coding: [{
            system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
            code: 'NN',
            display: 'PhilSys ID'
          }]
        };
        identifierObj.system = 'https://fhir.doh.gov.ph/identifier/philsys';
        identifierObj.assigner = {
          reference: 'Organization/psa',
          display: 'Philippine Statistics Authority'
        };
        identifierObj.extension = [{
          url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/identifier-location',
          valueString: 'Philippine Statistics Authority'
        }];
      }
      
      fhirPatient.identifier.push(identifierObj);
    });
  } else if (openmrsPatient.identifier) {
    fhirPatient.identifier.push({
      use: 'usual',
      type: {
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/v2-0203',
          code: 'MR'
        }]
      },
      value: openmrsPatient.identifier
    });
  }

  // Add names from person.names array
  if (person.names && Array.isArray(person.names)) {
    person.names.forEach(name => {
      if (!name.voided) {
        const nameObj = {
          use: name.preferred ? 'official' : 'usual',
          given: [],
          family: ''
        };
        
        if (name.givenName) nameObj.given.push(name.givenName);
        if (name.middleName) nameObj.given.push(name.middleName);
        if (name.familyName) nameObj.family = name.familyName;
        if (name.familyName2) nameObj.family += ' ' + name.familyName2;
        
        fhirPatient.name.push(nameObj);
      }
    });
  } else if (person.preferredName) {
    // Fallback to preferredName
    const nameObj = {
      use: 'official',
      given: [],
      family: ''
    };
    
    if (person.preferredName.givenName) nameObj.given.push(person.preferredName.givenName);
    if (person.preferredName.middleName) nameObj.given.push(person.preferredName.middleName);
    if (person.preferredName.familyName) nameObj.family = person.preferredName.familyName;
    
    fhirPatient.name.push(nameObj);
  } else {
    // Last fallback to simple structure
    fhirPatient.name.push({
      use: 'official',
      given: [person.givenName || openmrsPatient.givenName || ''],
      family: person.familyName || openmrsPatient.familyName || ''
    });
  }


  // Add addresses from person.addresses array
  if (person.addresses && Array.isArray(person.addresses)) {
    person.addresses.forEach(addr => {
      if (!addr.voided) {
        const address = {
          use: 'home',
          type: 'physical',
          country: 'PH',
          extension: []
        };
        
        if (addr.address1) address.line = [addr.address1];
        if (addr.address2) address.line = address.line || [], address.line.push(addr.address2);
        if (addr.cityVillage) address.city = addr.cityVillage;
        if (addr.stateProvince) address.state = addr.stateProvince;
        if (addr.countyDistrict) address.district = addr.countyDistrict;
        if (addr.postalCode) address.postalCode = addr.postalCode;
        
        // Add PH Core address extensions
        if (addr.countyDistrict) {
          address.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay',
            valueCoding: {
              system: 'https://psa.gov.ph/classification/psgc',
              code: '1380100001',
              display: addr.countyDistrict
            }
          });
        }
        
        if (addr.cityVillage) {
          address.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality',
            valueCoding: {
              system: 'https://psa.gov.ph/classification/psgc',
              code: '1380200000',
              display: addr.cityVillage
            }
          });
        }
        
        if (addr.stateProvince) {
          address.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/province',
            valueCoding: {
              system: 'https://psa.gov.ph/classification/psgc',
              code: '0402100000',
              display: addr.stateProvince
            }
          });
        }
        
        fhirPatient.address.push(address);
      }
    });
  } else if (person.preferredAddress) {
    // Fallback to preferredAddress
    const addr = person.preferredAddress;
    const address = {
      use: 'home',
      type: 'physical',
      country: 'PH',
      extension: []
    };
    
    if (addr.address1) address.line = [addr.address1];
    if (addr.address2) address.line = address.line || [], address.line.push(addr.address2);
    if (addr.cityVillage) address.city = addr.cityVillage;
    if (addr.stateProvince) address.state = addr.stateProvince;
    if (addr.countyDistrict) address.district = addr.countyDistrict;
    if (addr.postalCode) address.postalCode = addr.postalCode;
    
    // Add PH Core address extensions
    if (addr.countyDistrict) {
      address.extension.push({
        url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/barangay',
        valueCoding: {
          system: 'https://psa.gov.ph/classification/psgc',
          code: '1380100001',
          display: addr.countyDistrict
        }
      });
    }
    
    if (addr.cityVillage) {
      address.extension.push({
        url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/city-municipality',
        valueCoding: {
          system: 'https://psa.gov.ph/classification/psgc',
          code: '1380200000',
          display: addr.cityVillage
        }
      });
    }
    
    if (addr.stateProvince) {
      address.extension.push({
        url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/province',
        valueCoding: {
          system: 'https://psa.gov.ph/classification/psgc',
          code: '0402100000',
          display: addr.stateProvince
        }
      });
    }
    
    fhirPatient.address.push(address);
  }


  // Add phone numbers and email from person.attributes
  if (person.attributes && Array.isArray(person.attributes)) {
    person.attributes.forEach(attr => {
      if (!attr.voided && attr.value && attr.value !== 'n/a') {
        if (attr.attributeType) {
          const attrName = attr.attributeType.display || attr.attributeType.name;
          if (attrName.toLowerCase().includes('phone') || attrName.toLowerCase().includes('mobile')) {
            fhirPatient.telecom.push({
              system: 'phone',
              value: attr.value,
              use: 'mobile'
            });
          } else if (attrName.toLowerCase().includes('email')) {
            fhirPatient.telecom.push({
              system: 'email',
              value: attr.value,
              use: 'home'
            });
          }
        }
      }
    });
  }

  // Add nationality extension (default to Philippines)
  fhirPatient.extension.push({
    extension: [{
      url: 'code',
      valueCodeableConcept: {
        coding: [{
          system: 'urn:iso:std:iso:3166',
          code: 'PH',
          display: 'Philippines'
        }]
      }
    }],
    url: 'http://hl7.org/fhir/StructureDefinition/patient-nationality'
  });

  // Add PH Core extensions from person.attributes
  if (person.attributes && Array.isArray(person.attributes)) {
    person.attributes.forEach(attr => {
      if (!attr.voided && attr.value && attr.value !== 'n/a' && attr.attributeType) {
        const attrName = attr.attributeType.display || attr.attributeType.name;
        
        // Religion extension
        if (attrName.toLowerCase().includes('religion')) {
          fhirPatient.extension.push({
            url: 'http://hl7.org/fhir/StructureDefinition/patient-religion',
            valueCodeableConcept: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/v3-ReligiousAffiliation',
                code: attr.value,
                display: attr.value
              }]
            }
          });
        }
        
        // Indigenous group extension
        if (attrName.toLowerCase().includes('indigenous') && attrName.toLowerCase().includes('group')) {
          fhirPatient.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/indigenous-group',
            valueString: attr.value
          });
        }
        
        // Indigenous people extension
        if (attrName.toLowerCase().includes('indigenous') && !attrName.toLowerCase().includes('group')) {
          fhirPatient.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/indigenous-people',
            valueString: attr.value
          });
        }
        
        // Occupation extension
        if (attrName.toLowerCase().includes('occupation')) {
          fhirPatient.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/occupation',
            valueString: attr.value
          });
        }
        
        // Race extension
        if (attrName.toLowerCase().includes('race')) {
          fhirPatient.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/race',
            valueCodeableConcept: {
              coding: [{
                system: 'http://terminology.hl7.org/CodeSystem/v3-Race',
                code: '2036-2',
                display: attr.value || 'Filipino'
              }]
            }
          });
        }
        
        // Educational attainment extension
        if (attrName.toLowerCase().includes('education') || attrName.toLowerCase().includes('educational')) {
          fhirPatient.extension.push({
            url: 'https://fhir.doh.gov.ph/phcore/StructureDefinition/educational-attainment',
            valueString: attr.value
          });
        }
        
        // PWD/Disability extension
        if (attrName.toLowerCase().includes('pwd') || attrName.toLowerCase().includes('disability')) {
          fhirPatient.extension.push({
            extension: [{
              url: 'pwdId',
              valueString: attr.value
            },
            {
              url: 'disabilityType',
              valueCodeableConcept: {
                coding: [{
                  system: 'https://fhir.doh.gov.ph/pheref/CodeSystem/pwd-disability-type-cs',
                  code: 'physical',
                  display: 'Physical/Orthopedic Disability'
                }]
              }
            },
            {
              url: 'idExpirationDate',
              valueDate: '2027-03-15'
            }],
            url: 'https://fhir.doh.gov.ph/pheref/StructureDefinition/ereferral-pwd-disability'
          });
        }
      }
    });
  }

  // Add emergency contact from person.relationships
  if (person.relationships && Array.isArray(person.relationships)) {
    person.relationships.forEach(rel => {
      if (!rel.voided && rel.personB) {
        const contact = {
          relationship: [{
            coding: [{
              system: 'http://terminology.hl7.org/CodeSystem/v3-RoleCode',
              code: rel.relationshipType && rel.relationshipType.uuid ? rel.relationshipType.uuid : 'FTH',
              display: rel.relationshipType && rel.relationshipType.name ? rel.relationshipType.name : 'Father'
            }]
          }],
          name: {
            use: 'official',
            family: rel.personB.familyName || '',
            given: [rel.personB.givenName || '']
          }
        };
        
        // Add contact phone if available
        if (rel.personB.attributes && Array.isArray(rel.personB.attributes)) {
          rel.personB.attributes.forEach(attr => {
            if (!attr.voided && attr.value && attr.value !== 'n/a' && attr.attributeType) {
              const attrName = attr.attributeType.display || attr.attributeType.name;
              if (attrName.toLowerCase().includes('phone') || attrName.toLowerCase().includes('mobile')) {
                contact.telecom = [{
                  system: 'phone',
                  value: attr.value,
                  use: 'mobile'
                }];
              }
            }
          });
        }
        
        fhirPatient.contact.push(contact);
      }
    });
  }

  // Calculate age if birthdate is available
  if (person.birthdate) {
    const birthDate = new Date(person.birthdate);
    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }
    fhirPatient.extension.push({
      url: 'http://hl7.org/fhir/StructureDefinition/patient-age',
      valueInteger: age
    });
  }

  return fhirPatient;
}

/**
 * Format datetime to FHIR standard format
 */
function formatDateTimeToFhir(dateTime) {
  if (!dateTime) return null;
  
  // Handle OpenMRS datetime format: 2026-06-14T16:42:27.000+0000
  // Convert to FHIR format: 2026-06-14T16:42:27Z
  if (typeof dateTime === 'string') {
    // Replace +0000 with Z
    let formatted = dateTime.replace('+0000', 'Z');
    // Remove milliseconds if present
    formatted = formatted.replace(/\.\d+Z/, 'Z');
    return formatted;
  }
  
  const date = new Date(dateTime);
  if (isNaN(date.getTime())) return null;
  const isoString = date.toISOString();
  return isoString.replace('+00:00', 'Z').replace('.000Z', 'Z');
}

/**
 * Convert OpenMRS Encounter to FHIR Encounter
 */
function convertEncounterToFhir(openmrsEncounter) {
  if (!openmrsEncounter) {
    throw new Error('Encounter data is undefined');
  }
  
  const fhirEncounter = {
    resourceType: 'Encounter',
    id: openmrsEncounter.uuid || openmrsEncounter.encounterId || 'unknown',
    status: 'finished',
    class: {
      system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
      code: 'AMB',
      display: 'ambulatory'
    },
    period: {
      start: formatDateTimeToFhir(openmrsEncounter.encounterDatetime),
      end: formatDateTimeToFhir(openmrsEncounter.encounterDatetime)
    }
  };

  // Add subject reference to patient - OpenMRS stores patient UUID in encounter
  if (openmrsEncounter.patient && openmrsEncounter.patient.uuid) {
    fhirEncounter.subject = {
      reference: `Patient/${openmrsEncounter.patient.uuid}`,
      display: openmrsEncounter.patient.display || 'Unknown'
    };
  } else if (openmrsEncounter.patientUuid) {
    // Fallback to patientUuid if available
    fhirEncounter.subject = {
      reference: `Patient/${openmrsEncounter.patientUuid}`,
      display: openmrsEncounter.patientName || 'Unknown'
    };
  } else if (openmrsEncounter.person && openmrsEncounter.person.uuid) {
    // Fallback to person.uuid if patientUuid not available
    fhirEncounter.subject = {
      reference: `Patient/${openmrsEncounter.person.uuid}`,
      display: openmrsEncounter.person.display || 'Unknown'
    };
  }

  if (openmrsEncounter.encounterType) {
    fhirEncounter.type = [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: openmrsEncounter.encounterType.uuid || 'unknown',
        display: openmrsEncounter.encounterType.name || 'Unknown'
      }]
    }];
  }

  if (openmrsEncounter.locationUuid) {
    fhirEncounter.location = [{
      location: {
        reference: `Location/${openmrsEncounter.locationUuid}`
      }
    }];
  }

  return fhirEncounter;
}

/**
 * Convert OpenMRS Observation to FHIR Observation
 */
function convertObsToFhir(openmrsObs) {
  if (!openmrsObs) {
    throw new Error('Observation data is undefined');
  }
  
  const fhirObs = {
    resourceType: 'Observation',
    id: openmrsObs.uuid || openmrsObs.obsId || 'unknown',
    status: openmrsObs.voided ? 'cancelled' : 'final',
    effectiveDateTime: formatDateTimeToFhir(openmrsObs.obsDatetime),
    valueQuantity: null
  };

  // Add subject reference only if personUuid is available
  if (openmrsObs.personUuid) {
    fhirObs.subject = {
      reference: `Patient/${openmrsObs.personUuid}`
    };
  } else if (openmrsObs.person && openmrsObs.person.uuid) {
    // Fallback to person.uuid if personUuid not available
    fhirObs.subject = {
      reference: `Patient/${openmrsObs.person.uuid}`
    };
  }

  if (openmrsObs.concept) {
    fhirObs.code = {
      coding: [{
        system: 'http://openmrs.org',
        code: openmrsObs.concept.uuid || 'unknown',
        display: openmrsObs.concept.display || openmrsObs.concept.name || openmrsObs.concept.uuid || 'unknown'
      }]
    };
  }

  // Handle different value field names in OpenMRS
  if (openmrsObs.value !== null && openmrsObs.value !== undefined && typeof openmrsObs.value === 'number') {
    fhirObs.valueQuantity = {
      value: openmrsObs.value,
      unit: openmrsObs.valueUnits || openmrsObs.concept.units || ''
    };
  } else if (openmrsObs.valueNumeric !== null && openmrsObs.valueNumeric !== undefined) {
    fhirObs.valueQuantity = {
      value: openmrsObs.valueNumeric,
      unit: openmrsObs.valueUnits || openmrsObs.concept.units || ''
    };
  } else if (openmrsObs.valueText) {
    fhirObs.valueString = openmrsObs.valueText;
  } else if (openmrsObs.valueDatetime) {
    fhirObs.valueDateTime = openmrsObs.valueDatetime;
  } else if (openmrsObs.valueCoded) {
    fhirObs.valueCodeableConcept = {
      coding: [{
        system: 'http://openmrs.org',
        code: openmrsObs.valueCoded.uuid,
        display: openmrsObs.valueCoded.display || openmrsObs.valueCoded.name || openmrsObs.valueCoded.uuid
      }]
    };
  }

  if (openmrsObs.encounterUuid) {
    fhirObs.encounter = {
      reference: `Encounter/${openmrsObs.encounterUuid}`
    };
  }

  return fhirObs;
}

/**
 * Create a grouped vital signs observation from multiple individual observations
 */
function createGroupedVitalSignsObservation(observations, encounter) {
  if (!observations || observations.length === 0) {
    throw new Error('No observations provided for grouping');
  }

  // Use encounter UUID as the observation ID for consistency
  const observationId = encounter.uuid || 'unknown';

  const groupedObs = {
    resourceType: 'Observation',
    id: observationId,
    status: 'final',
    code: {
      coding: [{
        system: 'http://loinc.org',
        code: '85354-9',
        display: 'Vital signs, weight, height, blood pressure, pulse oximetry, temperature, respiratory rate panel'
      }],
      text: 'Vital Signs Panel'
    },
    effectiveDateTime: encounter.encounterDatetime ? formatDateTimeToFhir(encounter.encounterDatetime) : new Date().toISOString(),
    component: []
  };

  // Add patient reference if available
  if (encounter.patient && encounter.patient.uuid) {
    groupedObs.subject = {
      reference: `Patient/${encounter.patient.uuid}`,
      display: encounter.patient.display || 'Unknown'
    };
  }

  // Add encounter reference
  groupedObs.encounter = {
    reference: `Encounter/${encounter.uuid}`
  };

  // Process each observation as a component
  observations.forEach(obs => {
    if (!obs.voided && obs.concept) {
      const component = {
        code: {
          coding: [{
            system: 'http://openmrs.org',
            code: obs.concept.uuid,
            display: obs.concept.display || obs.concept.name || obs.concept.uuid
          }]
        }
      };

      // Add value based on type
      if (obs.value !== null && obs.value !== undefined && typeof obs.value === 'number') {
        component.valueQuantity = {
          value: obs.value,
          unit: obs.valueUnits || obs.concept.units || ''
        };
      } else if (obs.valueNumeric !== null && obs.valueNumeric !== undefined) {
        component.valueQuantity = {
          value: obs.valueNumeric,
          unit: obs.valueUnits || obs.concept.units || ''
        };
      } else if (obs.valueText) {
        component.valueString = obs.valueText;
      } else if (obs.valueCoded) {
        component.valueCodeableConcept = {
          coding: [{
            system: 'http://openmrs.org',
            code: obs.valueCoded.uuid,
            display: obs.valueCoded.display || obs.valueCoded.name || obs.valueCoded.uuid
          }]
        };
      }

      groupedObs.component.push(component);
    }
  });

  return groupedObs;
}

/**
 * Convert OpenMRS Lab to FHIR DiagnosticReport
 */
function convertLabToFhir(openmrsLab) {
  if (!openmrsLab) {
    throw new Error('Lab data is undefined');
  }
  
  const fhirDiagnosticReport = {
    resourceType: 'DiagnosticReport',
    id: openmrsLab.uuid || openmrsLab.labId || 'unknown',
    status: 'final',
    code: {
      coding: [{
        system: 'http://loinc.org',
        code: openmrsLab.conceptUuid || 'unknown',
        display: openmrsLab.conceptName || 'Laboratory Test'
      }]
    },
    effectiveDateTime: formatDateTimeToFhir(openmrsLab.dateCreated),
    issued: formatDateTimeToFhir(openmrsLab.dateCreated)
  };

  // Only add subject if patientUuid is available
  if (openmrsLab.patientUuid) {
    fhirDiagnosticReport.subject = {
      reference: `Patient/${openmrsLab.patientUuid}`
    };
  }

  if (openmrsLab.encounterUuid) {
    fhirDiagnosticReport.encounter = {
      reference: `Encounter/${openmrsLab.encounterUuid}`
    };
  }

  if (openmrsLab.results && Array.isArray(openmrsLab.results)) {
    fhirDiagnosticReport.result = openmrsLab.results.map(result => ({
      reference: `Observation/${result.uuid || result.obsId}`
    }));
  }

  return fhirDiagnosticReport;
}

/**
 * Convert OpenMRS Drug to FHIR MedicationRequest
 */
function convertDrugToFhir(openmrsDrug) {
  if (!openmrsDrug) {
    throw new Error('Drug data is undefined');
  }
  
  const fhirMedicationRequest = {
    resourceType: 'MedicationRequest',
    id: openmrsDrug.uuid || openmrsDrug.drugOrderId || 'unknown',
    status: 'active',
    intent: 'order',
    medicationCodeableConcept: {
      coding: [{
        system: 'http://openmrs.org',
        code: openmrsDrug.drugUuid || 'unknown',
        display: openmrsDrug.drugName || 'Unknown Drug'
      }]
    },
    authoredOn: formatDateTimeToFhir(openmrsDrug.dateCreated)
  };

  // Only add subject if patientUuid is available
  if (openmrsDrug.patientUuid) {
    fhirMedicationRequest.subject = {
      reference: `Patient/${openmrsDrug.patientUuid}`
    };
  }

  if (openmrsDrug.encounterUuid) {
    fhirMedicationRequest.encounter = {
      reference: `Encounter/${openmrsDrug.encounterUuid}`
    };
  }

  if (openmrsDrug.dosage) {
    fhirMedicationRequest.dosageInstruction = [{
      text: openmrsDrug.dosage
    }];
  }

  if (openmrsDrug.quantity) {
    fhirMedicationRequest.dispenseRequest = {
      quantity: {
        value: openmrsDrug.quantity,
        unit: openmrsDrug.dosageUnit || 'mg'
      }
    };
  }

  return fhirMedicationRequest;
}

/**
 * Convert OpenMRS Appointment to FHIR Appointment
 */
function convertAppointmentToFhir(openmrsAppointment) {
  if (!openmrsAppointment) {
    throw new Error('Appointment data is undefined');
  }
  
  const fhirAppointment = {
    resourceType: 'Appointment',
    id: openmrsAppointment.uuid || openmrsAppointment.appointmentId || 'unknown',
    status: openmrsAppointment.status || 'booked',
    start: formatDateTimeToFhir(openmrsAppointment.startDateTime),
    end: formatDateTimeToFhir(openmrsAppointment.endDateTime),
    participant: []
  };

  // Only add patient participant if patientUuid is available
  if (openmrsAppointment.patientUuid) {
    fhirAppointment.participant.push({
      actor: {
        reference: `Patient/${openmrsAppointment.patientUuid}`
      },
      status: 'accepted'
    });
  }

  if (openmrsAppointment.providerUuid) {
    fhirAppointment.participant.push({
      actor: {
        reference: `Practitioner/${openmrsAppointment.providerUuid}`
      },
      status: 'accepted'
    });
  }

  if (openmrsAppointment.appointmentType) {
    fhirAppointment.appointmentType = [{
      coding: [{
        system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode',
        code: openmrsAppointment.appointmentType,
        display: openmrsAppointment.appointmentType
      }]
    }];
  }

  return fhirAppointment;
}

/**
 * Convert OpenMRS data to FHIR based on resource type
 */
function convertToFhir(resourceType, openmrsData) {
  switch (resourceType) {
    case 'patient':
      return convertPatientToFhir(openmrsData);
    case 'encounter':
      return convertEncounterToFhir(openmrsData);
    case 'obs':
      return convertObsToFhir(openmrsData);
    default:
      throw new Error(`Unknown resource type: ${resourceType}`);
  }
}

/**
 * Send FHIR resource to HAPI server
 */
async function sendToFhir(fhirResource) {
  try {
    const resourceType = fhirResource.resourceType;
    // Remove trailing slash from FHIR_SERVER_URL to avoid double slashes
    const baseUrl = FHIR_SERVER_URL.replace(/\/$/, '');
    const url = `${baseUrl}/${resourceType}/${fhirResource.id}`;
    
    // Try to update first, if it fails with 404, create new
    try {
      await axios.put(url, fhirResource, {
        headers: {
          'Content-Type': 'application/fhir+json'
        }
      });
      console.log(`Updated ${resourceType}/${fhirResource.id}`);
    } catch (updateError) {
      if (updateError.response && updateError.response.status === 404) {
        await axios.post(`${baseUrl}/${resourceType}`, fhirResource, {
          headers: {
            'Content-Type': 'application/fhir+json'
          }
        });
        console.log(`Created ${resourceType}/${fhirResource.id}`);
      } else {
        console.error(`Update error details:`, JSON.stringify(updateError.response?.data, null, 2));
        throw updateError;
      }
    }

    // If this is a Patient resource, also send to external FHIR portal
    if (resourceType === 'Patient') {
      await sendToFhirPortal(fhirResource);
    }
  } catch (error) {
    console.error(`Error sending FHIR resource:`, error.message);
    if (error.response) {
      console.error(`Response data:`, JSON.stringify(error.response.data, null, 2));
    }
    throw error;
  }
}

/**
 * Send Patient resource to external FHIR portal
 */
async function sendToFhirPortal(fhirPatient) {
  try {
    const fhirPortalUrl = 'https://fhirportal.telehealth.ph/fhir/Patient';
    
    try {
      await axios.put(`${fhirPortalUrl}/${fhirPatient.id}`, fhirPatient, {
        headers: {
          'Content-Type': 'application/fhir+json'
        }
      });
      console.log(`Sent Patient ${fhirPatient.id} to FHIR portal (update)`);
    } catch (updateError) {
      if (updateError.response && updateError.response.status === 404) {
        await axios.post(fhirPortalUrl, fhirPatient, {
          headers: {
            'Content-Type': 'application/fhir+json'
          }
        });
        console.log(`Sent Patient ${fhirPatient.id} to FHIR portal (create)`);
      } else {
        console.error(`FHIR portal update error:`, updateError.message);
        // Don't throw - portal errors shouldn't stop the main flow
      }
    }
  } catch (error) {
    console.error(`Error sending to FHIR portal:`, error.message);
    // Don't throw - portal errors shouldn't stop the main flow
  }
}

/**
 * Fetch OpenMRS resource data via REST API
 */
async function fetchOpenmrsResource(resourceType, uuid) {
  try {
    // Map resource types to correct OpenMRS API endpoints
    const endpointMap = {
      patient: 'patient',
      encounter: 'encounter',
      obs: 'obs'
    };
    
    const endpoint = endpointMap[resourceType] || resourceType;
    
    const response = await axios.get(
      `http://${OPENMRS_HOST}:${OPENMRS_PORT}/openmrs/ws/rest/v1/${endpoint}/${uuid}`,
      {
        auth: {
          username: OPENMRS_USER,
          password: OPENMRS_PASSWORD
        },
        params: {
          v: 'full'
        }
      }
    );
    return response.data;
  } catch (error) {
    console.error(`Error fetching ${resourceType} ${uuid}:`, error.message);
    return null;
  }
}

/**
 * Process Bahmni event records
 */
async function processEvents(resourceType, events) {
  for (const event of events) {
    try {
      // Extract UUID from URI or object field
      let resourcePath = event.uri || event.object;
      if (!resourcePath) {
        console.log(`Skipping ${resourceType} event ${event.id} - no URI or object`);
        lastProcessedEventIds[resourceType] = event.id;
        continue;
      }
      
      // Remove query parameters and extract UUID
      const cleanPath = resourcePath.split('?')[0];
      const uuid = cleanPath.split('/').pop();
      
      console.log(`Processing ${resourceType} event ${event.id} with UUID: ${uuid}`);

      // Fetch full resource data from OpenMRS
      const openmrsData = await fetchOpenmrsResource(resourceType, uuid);
      if (!openmrsData) {
        console.log(`Skipping ${resourceType} ${uuid} - could not fetch data`);
        lastProcessedEventIds[resourceType] = event.id;
        continue;
      }

      // Convert to FHIR
      const fhirResource = convertToFhir(resourceType, openmrsData);

      // Send to HAPI FHIR
      await sendToFhir(fhirResource);

      // If this is an encounter, also process embedded observations as a grouped vital signs observation
      if (resourceType === 'encounter' && openmrsData.obs && Array.isArray(openmrsData.obs) && openmrsData.obs.length > 0) {
        console.log(`Processing ${openmrsData.obs.length} embedded observations from encounter as grouped vital signs`);
        try {
          const groupedObs = createGroupedVitalSignsObservation(openmrsData.obs, openmrsData);
          await sendToFhir(groupedObs);
          console.log(`Updated grouped Observation for encounter ${openmrsData.uuid}`);
        } catch (error) {
          console.error(`Error processing grouped observation:`, error.message);
        }
      }

      // Update last processed event ID
      lastProcessedEventIds[resourceType] = event.id;

    } catch (error) {
      console.error(`Error processing event:`, error.message);
      // Still update the last processed ID to avoid getting stuck
      lastProcessedEventIds[resourceType] = event.id;
    }
  }
}

/**
 * Poll Bahmni event system for updates
 */
async function pollEvents(resourceType) {
  try {
    console.log(`Polling ${resourceType} events from database`);

    const events = await queryNewEvents(resourceType);

    if (events.length > 0) {
      console.log(`Found ${events.length} new ${resourceType} events`);
      await processEvents(resourceType, events);
    } else {
      console.log(`No new ${resourceType} events`);
    }

  } catch (error) {
    console.error(`Error polling ${resourceType} events:`, error.message);
  }
}

/**
 * Main polling loop
 */
async function startPolling() {
  console.log('Starting Bahmni FHIR Event Listener...');
  console.log(`OpenMRS: http://${OPENMRS_HOST}:${OPENMRS_PORT}`);
  console.log(`FHIR Server: ${FHIR_SERVER_URL}`);
  console.log(`Database: ${DB_HOST}:${DB_PORT}/${DB_NAME}`);
  
  // Initial sync - get all recent data
  console.log('Performing initial sync...');
  for (const resourceType of Object.keys(lastProcessedEventIds)) {
    await pollEvents(resourceType);
  }

  // Continuous polling
  setInterval(async () => {
    for (const resourceType of Object.keys(lastProcessedEventIds)) {
      await pollEvents(resourceType);
    }
  }, 30000); // Poll every 30 seconds
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', lastProcessedEventIds });
});

// Start the server
app.listen(PORT, () => {
  console.log(`FHIR Atomfeed Listener running on port ${PORT}`);
  startPolling();
});

module.exports = app;
