import type {
	IExecuteFunctions,
	IDataObject,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';

import {
	baserowApiRequest,
	baserowApiRequestAllItems,
	getJwtToken,
	TableFieldMapper,
	toOptions,
} from './GenericFunctions';

import { operationFields } from './OperationDescription';

import type {
	BaserowCredentials,
	FieldsUiValues,
	GetAllAdditionalOptions,
	LoadedResource,
	Operation,
	Row,
} from './types';

export class BaserowAdvanced implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'BaserowAdvanced',
		name: 'baserowAdvanced',
		icon: 'file:baserowAdvanced.svg',
		group: ['output'],
		version: 1,
		description: 'Consume the Baserow API',
		subtitle: '={{$parameter["operation"] + ":" + $parameter["resource"]}}',
		defaults: {
			name: 'Baserow',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: 'baserowApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Row',
						value: 'row',
					},
				],
				default: 'row',
			},
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['row'],
					},
				},
				options: [
					{
						name: 'Create',
						value: 'create',
						description: 'Create a row',
						action: 'Create a row',
					},
					{
						name: 'Delete',
						value: 'delete',
						description: 'Delete a row',
						action: 'Delete a row',
					},
					{
						name: 'Get',
						value: 'get',
						description: 'Retrieve a row',
						action: 'Get a row',
					},
					{
						name: 'Get Many',
						value: 'getAll',
						description: 'Retrieve many rows',
						action: 'Get many rows',
					},
					{
						name: 'Update',
						value: 'update',
						description: 'Update a row',
						action: 'Update a row',
					},
				],
				default: 'getAll',
			},
			...operationFields,
		],
	};

	methods = {
		loadOptions: {
			async getDatabaseIds(this: ILoadOptionsFunctions) {
				const credentials = (await this.getCredentials('baserowApi')) as BaserowCredentials;
				const jwtToken = await getJwtToken.call(this, credentials);
				const endpoint = '/api/applications/';
				const databases = (await baserowApiRequest.call(
					this,
					'GET',
					endpoint,
					jwtToken,
				)) as LoadedResource[];
				return toOptions(databases);
			},

			async getTableIds(this: ILoadOptionsFunctions) {
				const credentials = (await this.getCredentials('baserowApi')) as BaserowCredentials;
				const jwtToken = await getJwtToken.call(this, credentials);
				const databaseId = this.getNodeParameter('databaseId', 0) as string;
				const endpoint = `/api/database/tables/database/${databaseId}/`;
				const tables = (await baserowApiRequest.call(
					this,
					'GET',
					endpoint,
					jwtToken,
				)) as LoadedResource[];
				return toOptions(tables);
			},

			async getTableFields(this: ILoadOptionsFunctions) {
				const credentials = (await this.getCredentials('baserowApi')) as BaserowCredentials;
				const jwtToken = await getJwtToken.call(this, credentials);
				const tableId = this.getNodeParameter('tableId', 0) as string;
				const endpoint = `/api/database/fields/table/${tableId}/`;
				const fields = (await baserowApiRequest.call(
					this,
					'GET',
					endpoint,
					jwtToken,
				)) as LoadedResource[];
				return toOptions(fields);
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const mapper = new TableFieldMapper();
		const returnData: INodeExecutionData[] = [];
		const operation = this.getNodeParameter('operation', 0) as Operation;
		const batchEnabled = this.getNodeParameter('batchEnabled', 0, false) as boolean;


		const tableId = this.getNodeParameter('tableId', 0) as string;
		const credentials = (await this.getCredentials('baserowApi')) as BaserowCredentials;
		const jwtToken = await getJwtToken.call(this, credentials);
		const fields = await mapper.getTableFields.call(this, tableId, jwtToken);
		mapper.createMappings(fields);

		if(batchEnabled){
			const batchSize = this.getNodeParameter('batchSize', 0, 0) as number;
			for (let b = 0; b < items.length; b=b+batchSize) {
				console.log('Batch: '+b);
				const batchItems = items.slice(b,(b+batchSize));
				if (operation === 'create') {
					// ----------------------------------
					//             create
					// ----------------------------------

					// https://api.baserow.io/api/redoc/#operation/create_database_table_row

					const bodyItems:IDataObject[] = [];
					for (let i = 0; i < batchItems.length; i++) {
						const body: IDataObject = {};
						const dataToSend = this.getNodeParameter('dataToSend', 0) as
						| 'defineBelow'
						| 'autoMapInputData';

						if (dataToSend === 'autoMapInputData') {
							const incomingKeys = Object.keys(batchItems[i].json);
							const rawInputsToIgnore = this.getNodeParameter('inputsToIgnore', b+i) as string;
							const inputDataToIgnore = rawInputsToIgnore.split(',').map((c) => c.trim());

							for (const key of incomingKeys) {
								if (inputDataToIgnore.includes(key)) continue;
								body[key] = batchItems[i].json[key];
								mapper.namesToIds(body);
							}
						} else {
							const fieldsUi = this.getNodeParameter('fieldsUi.fieldValues', b+i, []) as FieldsUiValues;
							for (const field of fieldsUi) {
								body[`field_${field.fieldId}`] = field.fieldValue;
							}
						}
						body.id = tableId
						bodyItems.push(body);
					}

					const endpoint = `/api/database/rows/table/${tableId}/batch/`;
					const createdRows = (await baserowApiRequest.call(this, 'POST', endpoint, jwtToken, {items:bodyItems})).items;
					for (let j = 0; j < createdRows.length; j++) {
						const	createdRow = createdRows[j];
						mapper.idsToNames(createdRow as Row);
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(createdRow as Row),
							{ itemData: { item: b+j } },
						);
						returnData.push(...executionData);
					}
				} else if (operation === 'update') {
					// ----------------------------------
					//             update
					// ----------------------------------

					// https://api.baserow.io/api/redoc/#operation/update_database_table_row
					const bodyItems:IDataObject[] = [];
					for (let i = 0; i < batchItems.length; i++) {
						const body: IDataObject = {};
						const rowId = this.getNodeParameter('rowId', b+i) as string;
						const dataToSend = this.getNodeParameter('dataToSend', 0) as
							| 'defineBelow'
							| 'autoMapInputData';

						if (dataToSend === 'autoMapInputData') {
							const incomingKeys = Object.keys(batchItems[i].json);
							const rawInputsToIgnore = this.getNodeParameter('inputsToIgnore', b+i) as string;
							const inputsToIgnore = rawInputsToIgnore.split(',').map((c) => c.trim());

							for (const key of incomingKeys) {
								if (inputsToIgnore.includes(key)) continue;
								body[key] = batchItems[i].json[key];
								mapper.namesToIds(body);
							}
						} else {
							const fieldsUi = this.getNodeParameter('fieldsUi.fieldValues', b+i, []) as FieldsUiValues;
							for (const field of fieldsUi) {
								body[`field_${field.fieldId}`] = field.fieldValue;
							}
						}
						body.id = rowId
						bodyItems.push(body);
					}

					const endpoint = `/api/database/rows/table/${tableId}/batch/`;
					const updatedRows = (await baserowApiRequest.call(this, 'PATCH', endpoint, jwtToken, {items:bodyItems})).items;

					for (let j = 0; j < updatedRows.length; j++) {
						const	updatedRow = updatedRows[j];
						mapper.idsToNames(updatedRow as Row);
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(updatedRow as Row),
							{ itemData: { item: b+j } },
						);

						returnData.push(...executionData);
					}
				} else if (operation === 'delete') {
					// ----------------------------------
					//             delete
					// ----------------------------------

					// https://api.baserow.io/api/redoc/#operation/delete_database_table_row
					const bodyItems:number[] = [];
					for (let i = 0; i < batchItems.length; i++) {

						const rowId = this.getNodeParameter('rowId', b+i) as string;
						bodyItems.push(+rowId)

					}
						const endpoint = `/api/database/rows/table/${tableId}/batch-delete/`;
						await baserowApiRequest.call(this, 'POST', endpoint, jwtToken,{items:bodyItems});

						for (let j = 0; j < bodyItems.length; j++) {
						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { success: true } }],
							{ itemData: { item: b+j } },
						);
						returnData.push(...executionData);
					}
				}
			}
		}
		else{
			for (let i = 0; i < items.length; i++) {
				try {
					if (operation === 'getAll') {
						// ----------------------------------
						//             getAll
						// ----------------------------------

						// https://api.baserow.io/api/redoc/#operation/list_database_table_rows

						const { order, filters, filterType, search } = this.getNodeParameter(
							'additionalOptions',
							i,
						) as GetAllAdditionalOptions;

						const qs: IDataObject = {};

						if (order?.fields) {
							qs.order_by = order.fields
								.map(({ field, direction }) => `${direction}${mapper.setField(field)}`)
								.join(',');
						}

						if (filters?.fields) {
							filters.fields.forEach(({ field, operator, value }) => {
								qs[`filter__field_${mapper.setField(field)}__${operator}`] = value;
							});
						}

						if (filterType) {
							qs.filter_type = filterType;
						}

						if (search) {
							qs.search = search;
						}

						const endpoint = `/api/database/rows/table/${tableId}/`;
						const rows = (await baserowApiRequestAllItems.call(
							this,
							'GET',
							endpoint,
							jwtToken,
							{},
							qs,
						)) as Row[];

						rows.forEach((row) => mapper.idsToNames(row));
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(rows),
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
					} else if (operation === 'get') {
						// ----------------------------------
						//             get
						// ----------------------------------

						// https://api.baserow.io/api/redoc/#operation/get_database_table_row

						const rowId = this.getNodeParameter('rowId', i) as string;
						const endpoint = `/api/database/rows/table/${tableId}/${rowId}/`;
						const row = await baserowApiRequest.call(this, 'GET', endpoint, jwtToken);

						mapper.idsToNames(row as Row);
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(row as Row),
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
					} else if (operation === 'create') {
						// ----------------------------------
						//             create
						// ----------------------------------

						// https://api.baserow.io/api/redoc/#operation/create_database_table_row

						const body: IDataObject = {};

						const dataToSend = this.getNodeParameter('dataToSend', 0) as
							| 'defineBelow'
							| 'autoMapInputData';

						if (dataToSend === 'autoMapInputData') {
							const incomingKeys = Object.keys(items[i].json);
							const rawInputsToIgnore = this.getNodeParameter('inputsToIgnore', i) as string;
							const inputDataToIgnore = rawInputsToIgnore.split(',').map((c) => c.trim());

							for (const key of incomingKeys) {
								if (inputDataToIgnore.includes(key)) continue;
								body[key] = items[i].json[key];
								mapper.namesToIds(body);
							}
						} else {
							const fieldsUi = this.getNodeParameter('fieldsUi.fieldValues', i, []) as FieldsUiValues;
							for (const field of fieldsUi) {
								body[`field_${field.fieldId}`] = field.fieldValue;
							}
						}

						const endpoint = `/api/database/rows/table/${tableId}/`;
						const createdRow = await baserowApiRequest.call(this, 'POST', endpoint, jwtToken, body);

						mapper.idsToNames(createdRow as Row);
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(createdRow as Row),
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
					} else if (operation === 'update') {
						// ----------------------------------
						//             update
						// ----------------------------------

						// https://api.baserow.io/api/redoc/#operation/update_database_table_row

						const rowId = this.getNodeParameter('rowId', i) as string;

						const body: IDataObject = {};

						const dataToSend = this.getNodeParameter('dataToSend', 0) as
							| 'defineBelow'
							| 'autoMapInputData';

						if (dataToSend === 'autoMapInputData') {
							const incomingKeys = Object.keys(items[i].json);
							const rawInputsToIgnore = this.getNodeParameter('inputsToIgnore', i) as string;
							const inputsToIgnore = rawInputsToIgnore.split(',').map((c) => c.trim());

							for (const key of incomingKeys) {
								if (inputsToIgnore.includes(key)) continue;
								body[key] = items[i].json[key];
								mapper.namesToIds(body);
							}
						} else {
							const fieldsUi = this.getNodeParameter('fieldsUi.fieldValues', i, []) as FieldsUiValues;
							for (const field of fieldsUi) {
								body[`field_${field.fieldId}`] = field.fieldValue;
							}
						}

						const endpoint = `/api/database/rows/table/${tableId}/${rowId}/`;
						const updatedRow = await baserowApiRequest.call(this, 'PATCH', endpoint, jwtToken, body);

						mapper.idsToNames(updatedRow as Row);
						const executionData = this.helpers.constructExecutionMetaData(
							this.helpers.returnJsonArray(updatedRow as Row),
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
					} else if (operation === 'delete') {
						// ----------------------------------
						//             delete
						// ----------------------------------

						// https://api.baserow.io/api/redoc/#operation/delete_database_table_row

						const rowId = this.getNodeParameter('rowId', i) as string;

						const endpoint = `/api/database/rows/table/${tableId}/${rowId}/`;
						await baserowApiRequest.call(this, 'DELETE', endpoint, jwtToken);

						const executionData = this.helpers.constructExecutionMetaData(
							[{ json: { success: true } }],
							{ itemData: { item: i } },
						);
						returnData.push(...executionData);
					}
				} catch (error) {
					if (this.continueOnFail()) {
						returnData.push({ error: error.message, json: {}, itemIndex: i });
						continue;
					}
					throw error;
				}
			}
		}
		console.log('return');
		return this.prepareOutputData(returnData);
		}
}
