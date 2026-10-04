import { Student } from '../models/student.model';

/**
 * A tutor sees a student they are assigned to, or teach in any schedule slot
 * (a second tutor takes single slots of another tutor's student).
 */
export function studentVisibleToTutor(
  student: Student,
  tutorId: string,
): boolean {
  return (
    student.assigned_tutor_id === tutorId ||
    (student.schedule ?? []).some((slot) => slot?.tutor_id === tutorId)
  );
}
