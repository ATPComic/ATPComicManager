import {
  compareVariantNames,
  getBaseVariantName,
  isSpecialVariantName
} from '../../public/variant-assignment-model.js';
import { getImageFileAssignments } from '../validation/filename.js';

export function getEffectiveVariantSources(episode) {
  const direct = [];
  for (const [fileIndex, file] of (episode?.files ?? []).entries()) {
    for (const assignment of getImageFileAssignments(file)) {
      direct.push({ file, fileIndex, assignment, inherited: false });
    }
  }

  const result = [...direct];
  const specialVariants = [...new Set(direct
    .map((item) => item.assignment.variant)
    .filter(isSpecialVariantName))];
  for (const specialVariant of specialVariants) {
    const baseVariant = getBaseVariantName(specialVariant);
    const overriddenPages = new Set(direct
      .filter((item) => item.assignment.variant === specialVariant)
      .map((item) => item.assignment.pageNumber));
    for (const item of direct) {
      if (item.assignment.variant !== baseVariant || overriddenPages.has(item.assignment.pageNumber)) continue;
      result.push({
        ...item,
        assignment: { ...item.assignment, variant: specialVariant },
        inherited: true
      });
    }
  }

  return result.sort((left, right) => (
    compareVariantNames(left.assignment.variant, right.assignment.variant)
    || left.assignment.pageNumber - right.assignment.pageNumber
    || left.fileIndex - right.fileIndex
  ));
}
