from setuptools import setup, Extension
import pybind11

ext_modules = [
    Extension(
        'fast_tensor',
        ['fast_tensor.cpp'],
        include_dirs=[pybind11.get_include()],
        extra_compile_args=['-O3', '-mavx2', '-fopenmp', '-std=c++20'],
        extra_link_args=['-fopenmp']
    ),
]

setup(
    name='fast_tensor',
    version='1.0',
    description='C++20 Tensor Extensions for Pairwise Distance',
    ext_modules=ext_modules,
)

