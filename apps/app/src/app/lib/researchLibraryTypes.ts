export interface ResearchStudy {
  strategy: string;
  id: string;
  title: string;
  date: string;
  kind: string;
  status: string;
}

export interface ResearchArtifact {
  id: string;
  label: string;
  kind: 'chart' | 'report';
}

export interface ResearchChart {
  title: string;
  unit: string;
  start: number;
  end: number;
  series: { label: string; points: [number, number][] }[];
}

export interface ResearchStudyDetail extends ResearchStudy {
  sections: { title: string; text: string }[];
  artifacts: ResearchArtifact[];
  chart: ResearchChart | null;
}
