import { initial } from './0001_visits.js';
import { addVisitClassification } from './0002_visit_classification.js';

export const migrations = {
	'0001_visits': initial,
	'0002_visit_classification': addVisitClassification
};
