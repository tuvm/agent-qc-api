export interface Segment {
  speaker: string;
  text: string;
  language: string;
  timestamp: {
    start: number;
    duration: number;
  };
}

export const processSpeakerSegments = (segments: Segment[], maxGapSeconds = 2.0): Segment[] => {
  if (!segments || segments.length === 0) {
    return segments;
  }

  // Sort segments by start time
  const sortedSegments = [...segments].sort((a, b) => 
    (a.timestamp?.start || 0) - (b.timestamp?.start || 0)
  );
  
  const processedSegments = [sortedSegments[0]];

  for (let i = 1; i < sortedSegments.length; i++) {
    const currentSegment = sortedSegments[i];
    const previousSegment = processedSegments[processedSegments.length - 1];
    
    // Check if same speaker and gap is small
    if (
      currentSegment.speaker === previousSegment.speaker && 
      (currentSegment.timestamp?.start || 0) - 
      ((previousSegment.timestamp?.start || 0) + 
       (previousSegment.timestamp?.duration || 0)) <= maxGapSeconds
    ) {
      // Merge text and update timestamp
      previousSegment.text += ' ' + currentSegment.text;
      previousSegment.timestamp.duration = 
        (currentSegment.timestamp?.start || 0) - 
        (previousSegment.timestamp?.start || 0) + 
        (currentSegment.timestamp?.duration || 0);
    } else {
      // Add new segment if different speaker or large gap
      processedSegments.push(currentSegment);
    }
  }

  return processedSegments;
};