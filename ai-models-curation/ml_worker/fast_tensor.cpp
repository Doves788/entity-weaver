#include <pybind11/pybind11.h>
#include <pybind11/numpy.h>
#include <cmath>
#include <omp.h> // For parallelization

namespace py = pybind11;

// C++20 Tensor Extensions for Pairwise Distance
// Scales distance matrix calculation via OpenMP / SIMD instructions
py::array_t<float> compute_cosine_distance_matrix(py::array_t<float> embeddings) {
    auto buf = embeddings.request();
    float* ptr = (float*)buf.ptr;
    
    size_t num_models = buf.shape[0];
    size_t embed_dim = buf.shape[1];
    
    auto result = py::array_t<float>({num_models, num_models});
    auto res_buf = result.request();
    float* res_ptr = (float*)res_buf.ptr;
    
    #pragma omp parallel for schedule(dynamic)
    for (size_t i = 0; i < num_models; ++i) {
        for (size_t j = 0; j < num_models; ++j) {
            float dot_product = 0.0f;
            float norm_i = 0.0f;
            float norm_j = 0.0f;
            
            // SIMD Vectorized Dot Product
            #pragma omp simd reduction(+:dot_product, norm_i, norm_j)
            for (size_t d = 0; d < embed_dim; ++d) {
                float val_i = ptr[i * embed_dim + d];
                float val_j = ptr[j * embed_dim + d];
                dot_product += val_i * val_j;
                norm_i += val_i * val_i;
                norm_j += val_j * val_j;
            }
            
            float distance = 1.0f - (dot_product / (std::sqrt(norm_i) * std::sqrt(norm_j) + 1e-8f));
            res_ptr[i * num_models + j] = distance;
        }
    }
    
    return result;
}

PYBIND11_MODULE(fast_tensor, m) {
    m.doc() = "C++20 SIMD Tensor Extension for Pairwise Cosine Distance";
    m.def("compute_cosine_distance_matrix", &compute_cosine_distance_matrix, "Compute NxN distance matrix");
}

