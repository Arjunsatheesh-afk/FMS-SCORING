import { useLocalSearchParams } from 'expo-router';

import ScreeningRecorder from '@/components/screening-recorder';

/**
 * A doctor recording for one patient. The patient comes from the route, so
 * there is no selector that can be left pointing at the wrong person.
 */
export default function DoctorRecordScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  return (
    <ScreeningRecorder
      patientId={Number(id)}
      patientName={name}
      completeHref={`/doctor/patients/${id}`}
    />
  );
}
