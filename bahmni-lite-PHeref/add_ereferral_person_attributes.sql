-- Add EReferral person attribute types to OpenMRS
-- Run this SQL script against the OpenMRS database

-- Nationality attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (50, '8d4f4f4c-2f4f-4f4f-8f4f-4f4f4f4f4f4f', 'Nationality', 'Patient nationality', 'java.lang.String', 1, 1, NOW(), 0, 1)
ON DUPLICATE KEY UPDATE name='Nationality', description='Patient nationality';

-- Religion attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (51, '9d5f5f5d-3f5f-5f5f-9f5f-5f5f5f5f5f5f', 'Religion', 'Patient religion', 'java.lang.String', 1, 1, NOW(), 0, 2)
ON DUPLICATE KEY UPDATE name='Religion', description='Patient religion';

-- Race attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (52, 'ae6f6f6e-4f6f-6f6f-af6f-6f6f6f6f6f6f', 'Race', 'Patient race/ethnicity', 'java.lang.String', 1, 1, NOW(), 0, 3)
ON DUPLICATE KEY UPDATE name='Race', description='Patient race/ethnicity';

-- PWD ID attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (53, 'bf7f7f7f-5f7f-7f7f-bf7f-7f7f7f7f7f7f', 'PWD ID', 'Person with Disability ID number', 'java.lang.String', 1, 1, NOW(), 0, 4)
ON DUPLICATE KEY UPDATE name='PWD ID', description='Person with Disability ID number';

-- Disability Type attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (54, 'c0808080-6080-8080-c080-808080808080', 'Disability Type', 'Type of disability', 'java.lang.String', 1, 1, NOW(), 0, 5)
ON DUPLICATE KEY UPDATE name='Disability Type', description='Type of disability';

-- PWD Expiration Date attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (55, 'd1919191-7191-9191-d191-919191919191', 'PWD Expiration Date', 'PWD ID expiration date', 'java.lang.String', 1, 1, NOW(), 0, 6)
ON DUPLICATE KEY UPDATE name='PWD Expiration Date', description='PWD ID expiration date';

-- Emergency Contact Name attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (56, 'e2a2a2a2-82a2-a2a2-e2a2-a2a2a2a2a2a2', 'Emergency Contact Name', 'Emergency contact person name', 'java.lang.String', 1, 1, NOW(), 0, 7)
ON DUPLICATE KEY UPDATE name='Emergency Contact Name', description='Emergency contact person name';

-- Emergency Contact Phone attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (57, 'f3b3b3b3-93b3-b3b3-f3b3-b3b3b3b3b3b3', 'Emergency Contact Phone', 'Emergency contact phone number', 'java.lang.String', 1, 1, NOW(), 0, 8)
ON DUPLICATE KEY UPDATE name='Emergency Contact Phone', description='Emergency contact phone number';

-- Emergency Contact Relationship attribute
INSERT INTO person_attribute_type (person_attribute_type_id, uuid, name, description, format, searchable, creator, date_created, retired, sort_weight)
VALUES (58, '04c4c4c4-a4c4-c4c4-04c4-c4c4c4c4c4c4', 'Emergency Contact Relationship', 'Relationship to emergency contact', 'java.lang.String', 1, 1, NOW(), 0, 9)
ON DUPLICATE KEY UPDATE name='Emergency Contact Relationship', description='Relationship to emergency contact';
