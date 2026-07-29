import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ontologyApi } from '../api/ontology';

export const useOntologyOverview = () => useQuery({ queryKey: ['ontologyOverview'], queryFn: ontologyApi.overview });
export const useOntologyArtifact = (name: 'standard' | 'observed' | 'mapped' | 'scorecard' | 'gap') =>
  useQuery({ queryKey: ['ontologyArtifact', name], queryFn: () => ontologyApi.artifact(name) });
export const useOntologyRoadmap = () => useQuery({ queryKey: ['ontologyRoadmap'], queryFn: ontologyApi.roadmap });

export const useOntologyCompile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ontologyApi.compile,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ontologyOverview'] });
      qc.invalidateQueries({ queryKey: ['ontologyArtifact'] });
    },
  });
};

export const useOntologyScan = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ontologyApi.scan,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ontologyOverview'] });
      qc.invalidateQueries({ queryKey: ['ontologyArtifact'] });
      qc.invalidateQueries({ queryKey: ['ontologyRoadmap'] });
    },
  });
};
