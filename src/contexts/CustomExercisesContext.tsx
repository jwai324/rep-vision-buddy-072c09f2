import React, { createContext, useContext } from 'react';
import { useCustomExercises } from '@/hooks/useCustomExercises';
import type { Exercise } from '@/data/exercises';
import type { CustomExerciseInput } from '@/hooks/useCustomExercises';

interface CustomExercisesContextValue {
  exercises: (Exercise & { isCustom: true; isRecovery: boolean })[];
  loading: boolean;
  addExercise: (input: CustomExerciseInput) => Promise<void>;
  deleteExercise: (id: string) => Promise<void>;
}

const CustomExercisesContext = createContext<CustomExercisesContextValue>({
  exercises: [],
  loading: true,
  addExercise: async () => {},
  deleteExercise: async () => {},
});

export const useCustomExercisesContext = () => useContext(CustomExercisesContext);

export const CustomExercisesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const hook = useCustomExercises();
  return (
    <CustomExercisesContext.Provider value={hook}>
      {children}
    </CustomExercisesContext.Provider>
  );
};
