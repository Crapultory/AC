import apiClient from './client';

export interface OntologyOverview {
  latest_scan_id: string | null;
  standard_graph_path: string;
  latest_scan_path: string | null;
  score: number | null;
  status_counts: Record<string, number>;
  generated_files: string[];
}

export interface OntologyScanResponse {
  scan_id: string;
  output_dir: string;
  score: number;
}

export interface OntologyRoadmapItem {
  node_id: string;
  title: string;
  domain: string;
  status: 'partial' | 'missing';
  importance_weight: number;
  fulfillment_ratio: number;
  priority: 'immediate' | 'high' | 'medium';
  rationale: string;
  recommendation: string;
}

export const ontologyApi = {
  compile: async (): Promise<OntologyScanResponse> => (await apiClient.post('/ontology/compile')).data,
  scan: async (): Promise<OntologyScanResponse> => (await apiClient.post('/ontology/scan')).data,
  overview: async (): Promise<OntologyOverview> => (await apiClient.get('/ontology/overview')).data,
  artifact: async (name: 'standard' | 'observed' | 'mapped' | 'scorecard' | 'gap') => (await apiClient.get(`/ontology/artifacts/${name}`)).data.data,
  roadmap: async (): Promise<{ items: OntologyRoadmapItem[] }> => (await apiClient.get('/ontology/roadmap')).data,
};
