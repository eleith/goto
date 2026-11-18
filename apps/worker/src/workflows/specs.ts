import { defineWorkflowSpec, type Workflow } from 'openworkflow';

export interface VisitMaintenanceInput {
	scheduled?: boolean;
}

export const visitMaintenanceSchedule = {
	id: 'goto:retain-visits',
	cron: '0 * * * *',
	timezone: 'UTC',
	input: { scheduled: true }
};

// Keep the durable identity so existing schedules and queued runs remain usable.
export const visitMaintenance: Workflow<
	VisitMaintenanceInput,
	'completed',
	VisitMaintenanceInput
>['spec'] = defineWorkflowSpec<VisitMaintenanceInput, 'completed'>({
	name: 'retain-visits',
	schedules: [visitMaintenanceSchedule]
});
