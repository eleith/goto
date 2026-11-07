import { defineWorkflowSpec, type Workflow } from 'openworkflow';

export interface ReportRefreshInput {
	scheduled?: boolean;
}

export const reportSchedule = {
	id: 'goto:retain-visits',
	cron: '0 * * * *',
	timezone: 'UTC',
	input: { scheduled: true }
};

// Keep the durable identity so existing schedules and queued runs remain usable.
export const refreshVisitReports: Workflow<
	ReportRefreshInput,
	'completed',
	ReportRefreshInput
>['spec'] = defineWorkflowSpec<ReportRefreshInput, 'completed'>({
	name: 'retain-visits',
	schedules: [reportSchedule]
});
