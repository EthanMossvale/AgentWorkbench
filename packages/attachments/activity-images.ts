import type {AttachmentView} from './types';

export interface ActivityImageRequest {sessionId:string;activityId:string}
/** Resolve only an existing native image-view activity, never arbitrary paths. */
export interface ActivityImagesService {read(input:ActivityImageRequest):Promise<AttachmentView[]>}
