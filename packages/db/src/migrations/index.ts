import { initial } from './0001_visits.js';
import { addVisitClassification } from './0002_visit_classification.js';
import { visitRetention } from './0003_visit_retention.js';
import { removeVisitCollection } from './0004_remove_visit_collection.js';

export const migrations = {
	'0001_visits': initial,
	'0002_visit_classification': addVisitClassification,
	'0003_visit_retention': visitRetention,
	'0004_remove_visit_collection': removeVisitCollection
};
